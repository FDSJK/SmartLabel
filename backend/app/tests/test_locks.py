from datetime import datetime, timedelta
from fastapi.testclient import TestClient


def _create_user_and_token(client: TestClient, name: str) -> str:
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username=name, password_hash=hash_password("pass"), role="annotator")
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)}), user.id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_image(client: TestClient, token: str) -> int:
    import os
    from PIL import Image as PILImage
    import numpy as np
    from app.main import app
    from app.core.db import get_db
    from app.models.batch import Batch
    from app.models.image import Image
    from app.core.config import settings

    work_dir = settings.WORK_DIR
    batches_dir = os.path.join(work_dir, "batches", "_locktest", "images")
    os.makedirs(batches_dir, exist_ok=True)
    img = PILImage.fromarray(np.zeros((10, 10, 3), dtype=np.uint8))
    img.save(os.path.join(batches_dir, "test.png"))

    db = next(app.dependency_overrides[get_db]())
    batch = db.query(Batch).filter(Batch.name == "_locktest").first()
    if not batch:
        batch = Batch(name="_locktest", source="upload")
        db.add(batch)
        db.commit()
        db.refresh(batch)

    image = Image(
        batch_id=batch.id,
        file_name="test.png",
        src_rel_path="batches/_locktest/images/test.png",
        width=10,
        height=10,
        channels=3,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return image.id


class TestAcquireLock:
    def test_acquire_free_lock(self, client: TestClient):
        token, _ = _create_user_and_token(client, "locker1")
        image_id = _create_image(client, token)

        resp = client.post(f"/api/images/{image_id}/lock", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["locked"] is True
        assert data["locked_by_username"] == "locker1"

    def test_acquire_same_user_refreshes(self, client: TestClient):
        token, _ = _create_user_and_token(client, "locker2")
        image_id = _create_image(client, token)

        # First acquire
        client.post(f"/api/images/{image_id}/lock", headers=_auth(token))
        # Second acquire by same user
        resp = client.post(f"/api/images/{image_id}/lock", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["locked"] is True

    def test_acquire_blocked_by_other(self, client: TestClient):
        token1, _ = _create_user_and_token(client, "locker_a")
        token2, _ = _create_user_and_token(client, "locker_b")
        image_id = _create_image(client, token1)

        # User A locks
        client.post(f"/api/images/{image_id}/lock", headers=_auth(token1))
        # User B tries to lock
        resp = client.post(f"/api/images/{image_id}/lock", headers=_auth(token2))
        assert resp.status_code == 200
        data = resp.json()
        assert data["locked"] is False
        assert data["locked_by_username"] == "locker_a"

    def test_acquire_expired_lock(self, client: TestClient):
        token1, uid1 = _create_user_and_token(client, "locker_c")
        token2, _ = _create_user_and_token(client, "locker_d")
        image_id = _create_image(client, token1)

        # User C locks, then we manually expire it
        client.post(f"/api/images/{image_id}/lock", headers=_auth(token1))
        from app.main import app
        from app.core.db import get_db
        db = next(app.dependency_overrides[get_db]())
        from app.models.image import Image
        img = db.query(Image).filter(Image.id == image_id).first()
        img.locked_at = datetime.utcnow() - timedelta(minutes=31)
        db.commit()

        # User D should now be able to lock
        resp = client.post(f"/api/images/{image_id}/lock", headers=_auth(token2))
        assert resp.status_code == 200
        assert resp.json()["locked"] is True
        assert resp.json()["locked_by_username"] == "locker_d"

    def test_acquire_lock_404(self, client: TestClient):
        token, _ = _create_user_and_token(client, "locker_e")
        resp = client.post("/api/images/99999/lock", headers=_auth(token))
        assert resp.status_code == 404

    def test_acquire_lock_requires_auth(self, client: TestClient):
        resp = client.post("/api/images/1/lock")
        assert resp.status_code == 401


class TestHeartbeat:
    def test_heartbeat_when_holding_lock(self, client: TestClient):
        token, _ = _create_user_and_token(client, "hb1")
        image_id = _create_image(client, token)

        client.post(f"/api/images/{image_id}/lock", headers=_auth(token))
        resp = client.post(f"/api/images/{image_id}/heartbeat", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_heartbeat_without_lock(self, client: TestClient):
        token, _ = _create_user_and_token(client, "hb2")
        image_id = _create_image(client, token)

        resp = client.post(f"/api/images/{image_id}/heartbeat", headers=_auth(token))
        assert resp.status_code == 409

    def test_heartbeat_404(self, client: TestClient):
        token, _ = _create_user_and_token(client, "hb3")
        resp = client.post("/api/images/99999/heartbeat", headers=_auth(token))
        assert resp.status_code == 404


class TestReleaseLock:
    def test_release_own_lock(self, client: TestClient):
        token, _ = _create_user_and_token(client, "rel1")
        image_id = _create_image(client, token)

        client.post(f"/api/images/{image_id}/lock", headers=_auth(token))
        resp = client.delete(f"/api/images/{image_id}/lock", headers=_auth(token))
        assert resp.status_code == 204

        # Verify lock is free
        from app.main import app
        from app.core.db import get_db
        db = next(app.dependency_overrides[get_db]())
        from app.models.image import Image
        img = db.query(Image).filter(Image.id == image_id).first()
        assert img.locked_by is None

    def test_release_idempotent(self, client: TestClient):
        token, _ = _create_user_and_token(client, "rel2")
        image_id = _create_image(client, token)

        resp = client.delete(f"/api/images/{image_id}/lock", headers=_auth(token))
        assert resp.status_code == 204

    def test_release_lock_404(self, client: TestClient):
        token, _ = _create_user_and_token(client, "rel3")
        resp = client.delete("/api/images/99999/lock", headers=_auth(token))
        assert resp.status_code == 404
