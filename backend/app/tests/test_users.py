from fastapi.testclient import TestClient


def _create_admin(client: TestClient) -> str:
    """Create an admin user directly in the DB and return a token."""
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


def test_list_users_requires_admin(client: TestClient):
    resp = client.get("/api/users")
    assert resp.status_code == 401


def test_create_user_as_admin(client: TestClient):
    token = _create_admin(client)
    resp = client.post(
        "/api/users",
        json={"username": "u1", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "u1"
    assert data["role"] == "annotator"
    assert data["is_active"] is True
    assert "id" in data


def test_create_duplicate_user_returns_409(client: TestClient):
    token = _create_admin(client)
    client.post(
        "/api/users",
        json={"username": "dup", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = client.post(
        "/api/users",
        json={"username": "dup", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409


def test_list_users_as_admin(client: TestClient):
    token = _create_admin(client)
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_update_user_as_admin(client: TestClient):
    token = _create_admin(client)
    create_resp = client.post(
        "/api/users",
        json={"username": "u2", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = create_resp.json()["id"]
    resp = client.put(
        f"/api/users/{user_id}",
        json={"is_active": False, "role": "admin"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_active"] is False
    assert data["role"] == "admin"


def test_update_nonexistent_user_returns_404(client: TestClient):
    token = _create_admin(client)
    resp = client.put(
        "/api/users/99999",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
