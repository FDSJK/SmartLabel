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


def _annotator_token(client: TestClient) -> str:
    resp = client.post("/api/auth/register", json={"username": "ann1", "password": "pass1234"})
    return resp.json()["access_token"]


class TestCreateLabel:
    def test_create_label_success(self, client: TestClient):
        token = _admin_token(client)
        resp = client.post("/api/labels", json={"name": "cat", "color": "#ff0000"}, headers=_auth(token))
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "cat"
        assert data["color"] == "#ff0000"

    def test_create_label_default_color(self, client: TestClient):
        token = _admin_token(client)
        resp = client.post("/api/labels", json={"name": "dog"}, headers=_auth(token))
        assert resp.status_code == 201
        assert resp.json()["color"] == "#3388ff"

    def test_create_duplicate_label_409(self, client: TestClient):
        token = _admin_token(client)
        client.post("/api/labels", json={"name": "bird", "color": "#111111"}, headers=_auth(token))
        resp = client.post("/api/labels", json={"name": "bird", "color": "#222222"}, headers=_auth(token))
        assert resp.status_code == 409

    def test_create_label_requires_admin(self, client: TestClient):
        token = _annotator_token(client)
        resp = client.post("/api/labels", json={"name": "fish"}, headers=_auth(token))
        assert resp.status_code == 403


class TestListLabels:
    def test_list_labels_as_annotator(self, client: TestClient):
        token = _annotator_token(client)
        resp = client.get("/api/labels", headers=_auth(token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_labels_requires_auth(self, client: TestClient):
        resp = client.get("/api/labels")
        assert resp.status_code == 401


class TestUpdateLabel:
    def test_update_label_name(self, client: TestClient):
        token = _admin_token(client)
        create = client.post("/api/labels", json={"name": "old"}, headers=_auth(token))
        label_id = create.json()["id"]
        resp = client.put(f"/api/labels/{label_id}", json={"name": "new"}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["name"] == "new"

    def test_update_label_404(self, client: TestClient):
        token = _admin_token(client)
        resp = client.put("/api/labels/99999", json={"name": "x"}, headers=_auth(token))
        assert resp.status_code == 404


class TestDeleteLabel:
    def test_delete_label(self, client: TestClient):
        token = _admin_token(client)
        create = client.post("/api/labels", json={"name": "tmp"}, headers=_auth(token))
        label_id = create.json()["id"]
        resp = client.delete(f"/api/labels/{label_id}", headers=_auth(token))
        assert resp.status_code == 204

    def test_delete_label_404(self, client: TestClient):
        token = _admin_token(client)
        resp = client.delete("/api/labels/99999", headers=_auth(token))
        assert resp.status_code == 404


class TestImportTxt:
    def test_import_labels_from_txt(self, client: TestClient):
        token = _admin_token(client)
        txt = "person\ncar,#ff0000\n__ignore__\n# comment\nbike,#00ff00"
        resp = client.post(
            "/api/labels/import-txt",
            json={"content": txt},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = {item["name"] for item in data}
        assert "person" in names
        assert "car" in names
        assert "bike" in names
        assert "__ignore__" not in names
        car = next(item for item in data if item["name"] == "car")
        assert car["color"] == "#ff0000"

    def test_import_updates_existing_label_color(self, client: TestClient):
        token = _admin_token(client)
        client.post("/api/labels", json={"name": "cat", "color": "#111111"}, headers=_auth(token))
        resp = client.post(
            "/api/labels/import-txt",
            json={"content": "cat,#ffaa00"},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        cat = resp.json()[0]
        assert cat["color"] == "#ffaa00"

    def test_import_requires_admin(self, client: TestClient):
        token = _annotator_token(client)
        resp = client.post("/api/labels/import-txt", json={"content": "x"}, headers=_auth(token))
        assert resp.status_code == 403
