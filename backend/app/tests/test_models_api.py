def _admin_token(client):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=settings.WORK_DIR)
    db.add(user); db.commit(); db.refresh(user)
    db.close()
    return create_access_token({"sub": str(user.id)})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_model(client):
    token = _admin_token(client)
    body = {"name": "unet", "source": "path", "model_path": "/tmp/x.onnx",
            "categories": [{"label": "cat", "channel": 1}], "background_channel": 0}
    r = client.post("/api/models", json=body, headers=_auth(token))
    assert r.status_code == 201
    assert r.json()["background_channel"] == 0
    lst = client.get("/api/models", headers=_auth(token)).json()
    assert len(lst) == 1


def test_create_model_requires_admin(client):
    r = client.post("/api/auth/register", json={"username": "ann", "password": "pass1234"})
    token = r.json()["access_token"]
    body = {"name": "m", "source": "path", "model_path": "/x.onnx"}
    assert client.post("/api/models", json=body, headers=_auth(token)).status_code == 403


def test_upload_onnx(client, tmp_work_dir, monkeypatch):
    token = _admin_token(client)
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    r = client.post("/api/models/upload",
                    files={"file": ("m.onnx", b"fakebytes", "application/octet-stream")},
                    headers=_auth(token))
    assert r.status_code == 200
    import os
    assert os.path.isfile(os.path.join(tmp_work_dir, r.json()["filename"]))


def test_update_model_name_conflict_409(client):
    token = _admin_token(client)
    b1 = {"name": "m1", "source": "path", "model_path": "/x1.onnx"}
    b2 = {"name": "m2", "source": "path", "model_path": "/x2.onnx"}
    id1 = client.post("/api/models", json=b1, headers=_auth(token)).json()["id"]
    client.post("/api/models", json=b2, headers=_auth(token))
    r = client.put(f"/api/models/{id1}", json={**b1, "name": "m2"}, headers=_auth(token))
    assert r.status_code == 409
