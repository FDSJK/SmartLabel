import os
import json
from fastapi.testclient import TestClient
from PIL import Image as PILImage
import numpy as np


def _admin_token(client: TestClient) -> str:
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin_ann", password_hash=hash_password("admin"), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _setup_image(client: TestClient, token: str) -> tuple[int, str, str, int, int]:
    """Create a batch + image in DB and on disk. Returns (image_id, batch_name, file_name, width, height)."""
    from app.main import app
    from app.core.db import get_db
    from app.models.batch import Batch
    from app.models.image import Image
    from app.core.config import settings

    work_dir = settings.WORK_DIR
    os.makedirs(os.path.join(work_dir, "batches", "test-annot", "images"), exist_ok=True)
    img = PILImage.fromarray(np.zeros((20, 30, 3), dtype=np.uint8))
    img.save(os.path.join(work_dir, "batches", "test-annot", "images", "img1.png"))

    db = next(app.dependency_overrides[get_db]())
    batch = db.query(Batch).filter(Batch.name == "test-annot").first()
    if not batch:
        batch = Batch(name="test-annot", source="upload")
        db.add(batch)
        db.commit()
        db.refresh(batch)

    image = Image(
        batch_id=batch.id,
        file_name="img1.png",
        src_rel_path="batches/test-annot/images/img1.png",
        width=30,
        height=20,
        channels=3,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return image.id, "test-annot", "img1.png", 30, 20


class TestGetAnnotation:
    def test_get_empty_annotation(self, client: TestClient):
        token = _admin_token(client)
        image_id, _, fname, w, h = _setup_image(client, token)

        resp = client.get(f"/api/images/{image_id}/annotation", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["shapes"] == []
        assert data["labelStatus"] == {}
        assert data["version"] == 0
        assert data["imageName"] == fname
        assert data["imageWidth"] == w
        assert data["imageHeight"] == h

    def test_get_annotation_404(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/images/99999/annotation", headers=_auth(token))
        assert resp.status_code == 404


class TestSaveAnnotation:
    def test_save_new_annotation(self, client: TestClient):
        token = _admin_token(client)
        image_id, batch_name, fname, w, h = _setup_image(client, token)

        body = {
            "expectedRev": 0,
            "shapes": [
                {
                    "id": "shape-1",
                    "label": "tumor",
                    "shapeType": "polygon",
                    "points": [[10, 10], [20, 10], [15, 18]],
                }
            ],
            "labelStatus": {"tumor": "present"},
        }
        resp = client.put(
            f"/api/images/{image_id}/annotation",
            json=body,
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rev"] == 1
        assert len(data["shapes"]) == 1
        assert "savedAt" in data

        # Verify sidecar JSON was written
        from app.main import app
        from app.core.db import get_db
        from app.core.config import settings
        db = next(app.dependency_overrides[get_db]())
        from app.models.image import Image
        img = db.query(Image).filter(Image.id == image_id).first()
        assert img.annotation_rev == 1
        assert img.status == "in_progress"

        # Verify sidecar file exists
        work_dir = settings.WORK_DIR
        json_path = os.path.join(work_dir, "batches", batch_name, "annotations", "img1.json")
        assert os.path.isfile(json_path)
        with open(json_path) as f:
            saved = json.load(f)
        assert saved["version"] == 1
        assert len(saved["shapes"]) == 1

    def test_save_read_roundtrip(self, client: TestClient):
        token = _admin_token(client)
        image_id, _, _, _, _ = _setup_image(client, token)

        body = {
            "expectedRev": 0,
            "shapes": [
                {
                    "id": "s1",
                    "label": "vessel",
                    "shapeType": "polygon",
                    "points": [[5, 5], [10, 5], [7, 10]],
                }
            ],
            "labelStatus": {},
        }
        client.put(f"/api/images/{image_id}/annotation", json=body, headers=_auth(token))

        # Read back
        resp = client.get(f"/api/images/{image_id}/annotation", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["version"] == 1
        assert len(data["shapes"]) == 1
        assert data["shapes"][0]["label"] == "vessel"

    def test_version_conflict(self, client: TestClient):
        token = _admin_token(client)
        image_id, _, _, _, _ = _setup_image(client, token)

        # Save once
        body = {
            "expectedRev": 0,
            "shapes": [{"id": "s1", "label": "a", "shapeType": "polygon", "points": [[1, 1], [2, 1], [1, 2]]}],
            "labelStatus": {},
        }
        client.put(f"/api/images/{image_id}/annotation", json=body, headers=_auth(token))

        # Try to save with old rev
        resp = client.put(f"/api/images/{image_id}/annotation", json=body, headers=_auth(token))
        assert resp.status_code == 409

    def test_second_save_increments_rev(self, client: TestClient):
        token = _admin_token(client)
        image_id, _, _, _, _ = _setup_image(client, token)

        # First save
        client.put(
            f"/api/images/{image_id}/annotation",
            json={
                "expectedRev": 0,
                "shapes": [{"id": "s1", "label": "a", "shapeType": "polygon", "points": [[1, 1], [2, 1], [1, 2]]}],
                "labelStatus": {},
            },
            headers=_auth(token),
        )

        # Second save with correct expectedRev
        resp = client.put(
            f"/api/images/{image_id}/annotation",
            json={
                "expectedRev": 1,
                "shapes": [{"id": "s2", "label": "b", "shapeType": "polygon", "points": [[5, 5], [8, 5], [6, 8]]}],
                "labelStatus": {},
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["rev"] == 2

    def test_save_annotation_404(self, client: TestClient):
        token = _admin_token(client)
        body = {
            "expectedRev": 0,
            "shapes": [],
            "labelStatus": {},
        }
        resp = client.put("/api/images/99999/annotation", json=body, headers=_auth(token))
        assert resp.status_code == 404

    def test_save_annotation_requires_auth(self, client: TestClient):
        body = {"expectedRev": 0, "shapes": [], "labelStatus": {}}
        resp = client.put("/api/images/1/annotation", json=body)
        assert resp.status_code == 401
