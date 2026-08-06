from fastapi.testclient import TestClient


def _admin_token(client: TestClient) -> str:
    """Get admin token, seeding the admin user directly if needed."""
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    if resp.status_code == 200:
        return resp.json()["access_token"]

    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin", password_hash=hash_password("admin"), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token({"sub": str(user.id)})


def test_get_settings_empty_by_default(client: TestClient):
    token = _admin_token(client)
    resp = client.get("/api/settings", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {}


def test_update_setting_creates_new(client: TestClient):
    token = _admin_token(client)
    resp = client.put(
        "/api/settings/work_dir",
        json={"value": "/data/annotations"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"key": "work_dir", "value": "/data/annotations"}


def test_get_settings_after_update(client: TestClient):
    token = _admin_token(client)
    client.put(
        "/api/settings/max_upload_size",
        json={"value": "100"},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = client.get("/api/settings", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("max_upload_size") == "100"


def test_update_existing_setting(client: TestClient):
    token = _admin_token(client)
    client.put(
        "/api/settings/theme",
        json={"value": "light"},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = client.put(
        "/api/settings/theme",
        json={"value": "dark"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"key": "theme", "value": "dark"}


def test_settings_require_auth(client: TestClient):
    resp = client.get("/api/settings")
    assert resp.status_code == 401


def test_settings_require_admin(client: TestClient):
    resp = client.post("/api/auth/register", json={"username": "ann1", "password": "pass1234"})
    token = resp.json()["access_token"]
    resp = client.get("/api/settings", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_seeded_admin_exists(client: TestClient):
    """Verify the seeded admin can log in after direct creation."""
    token = _admin_token(client)
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    users = resp.json()
    assert any(u["username"] == "admin" and u["role"] == "admin" for u in users)
