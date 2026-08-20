from fastapi.testclient import TestClient


def _admin_token(client: TestClient) -> str:
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=settings.WORK_DIR)
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _annotator_token(client, username):
    resp = client.post("/api/auth/register", json={"username": username, "password": "pass1234"})
    token = resp.json()["access_token"]
    client.put("/api/users/me/work_dir", json={"work_dir": "/tmp/annotator-workdir"}, headers=_auth(token))
    return token


class TestCreateBatch:
    def test_create_batch_success(self, client: TestClient):
        token = _admin_token(client)
        resp = client.post("/api/batches", json={"name": "batch1"}, headers=_auth(token))
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "batch1"
        assert data["source"] == "upload"
        assert data["image_count"] == 0
        assert data["done_count"] == 0

    def test_create_duplicate_batch_409(self, client: TestClient):
        token = _admin_token(client)
        client.post("/api/batches", json={"name": "dup-batch"}, headers=_auth(token))
        resp = client.post("/api/batches", json={"name": "dup-batch"}, headers=_auth(token))
        assert resp.status_code == 409

    def test_create_batch_as_annotator(self, client: TestClient):
        token = _annotator_token(client, "ann1")
        resp = client.post("/api/batches", json={"name": "mine"}, headers=_auth(token))
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "mine"

        from app.main import app
        from app.core.db import get_db
        from app.models.batch import Batch
        from app.models.user import User
        db = next(app.dependency_overrides[get_db]())
        user = db.query(User).filter(User.username == "ann1").first()
        batch = db.query(Batch).filter(Batch.name == "mine").first()
        assert batch.created_by == user.id
        db.close()


class TestListBatches:
    def test_list_batches_empty(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/batches", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_batches_requires_auth(self, client: TestClient):
        resp = client.get("/api/batches")
        assert resp.status_code == 401


class TestListImages:
    def test_404_for_nonexistent_batch(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/batches/99999/images", headers=_auth(token))
        assert resp.status_code == 404


class TestGetImage:
    def test_404_for_nonexistent_image(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/images/99999", headers=_auth(token))
        assert resp.status_code == 404


class TestDeleteBatch:
    def test_delete_empty_batch(self, client: TestClient):
        token = _admin_token(client)
        create = client.post("/api/batches", json={"name": "to-delete"}, headers=_auth(token))
        batch_id = create.json()["id"]
        resp = client.delete(f"/api/batches/{batch_id}", headers=_auth(token))
        assert resp.status_code == 204
        # Verify gone
        list_resp = client.get("/api/batches", headers=_auth(token))
        assert all(b["id"] != batch_id for b in list_resp.json())

    def test_delete_batch_404(self, client: TestClient):
        token = _admin_token(client)
        resp = client.delete("/api/batches/99999", headers=_auth(token))
        assert resp.status_code == 404

    def test_delete_batch_as_annotator(self, client: TestClient):
        token = _annotator_token(client, "ann_del")
        create = client.post("/api/batches", json={"name": "mine-del"}, headers=_auth(token))
        batch_id = create.json()["id"]
        resp = client.delete(f"/api/batches/{batch_id}", headers=_auth(token))
        assert resp.status_code == 204


def test_batches_isolated_per_user(client):
    t1 = _annotator_token(client, "annA")
    t2 = _annotator_token(client, "annB")
    client.post("/api/batches", json={"name": "mine"}, headers=_auth(t1))
    assert client.get("/api/batches", headers=_auth(t2)).json() == []
    assert len(client.get("/api/batches", headers=_auth(t1)).json()) == 1


def test_same_batch_name_allowed_across_users(client):
    t1 = _annotator_token(client, "annC")
    t2 = _annotator_token(client, "annD")
    assert client.post("/api/batches", json={"name": "same"}, headers=_auth(t1)).status_code == 201
    assert client.post("/api/batches", json={"name": "same"}, headers=_auth(t2)).status_code == 201


def test_same_batch_name_conflict_within_user(client):
    t1 = _annotator_token(client, "annE")
    client.post("/api/batches", json={"name": "dup"}, headers=_auth(t1))
    assert client.post("/api/batches", json={"name": "dup"}, headers=_auth(t1)).status_code == 409


def test_scan_requires_work_dir(client):
    resp = client.post("/api/auth/register", json={"username": "nowd", "password": "pass1234"})
    token = resp.json()["access_token"]
    r = client.post("/api/batches/scan", headers=_auth(token))
    assert r.status_code == 400
