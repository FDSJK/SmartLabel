from fastapi.testclient import TestClient


def _admin_token(client: TestClient) -> str:
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


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

    def test_create_batch_requires_admin(self, client: TestClient):
        resp = client.post("/api/auth/register", json={"username": "ann1", "password": "pass1234"})
        token = resp.json()["access_token"]
        resp = client.post("/api/batches", json={"name": "nope"}, headers=_auth(token))
        assert resp.status_code == 403


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
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetImage:
    def test_404_for_nonexistent_image(self, client: TestClient):
        token = _admin_token(client)
        resp = client.get("/api/images/99999", headers=_auth(token))
        assert resp.status_code == 404
