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


def test_delete_user_as_admin(client: TestClient):
    token = _create_admin(client)
    # Create an annotator to delete
    create_resp = client.post(
        "/api/users",
        json={"username": "del_me", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = create_resp.json()["id"]
    resp = client.delete(f"/api/users/{user_id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204
    # Verify user is gone
    list_resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert all(u["id"] != user_id for u in list_resp.json())


def test_delete_self_returns_400(client: TestClient):
    from app.core.security import create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="selfdel", password_hash="x", role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    resp = client.delete(f"/api/users/{user.id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_delete_other_admin_succeeds(client: TestClient):
    """Primary admin can delete another admin."""
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    from app.core.security import create_access_token, hash_password

    db = next(app.dependency_overrides[get_db]())
    primary = User(username="admin", password_hash=hash_password("x"), role="admin")
    db.add(primary)
    db.commit()
    db.refresh(primary)
    token = create_access_token({"sub": str(primary.id)})

    # Create a second admin
    create_resp = client.post(
        "/api/users",
        json={"username": "admin2", "password": "pass1234", "role": "admin"},
        headers={"Authorization": f"Bearer {token}"},
    )
    admin2_id = create_resp.json()["id"]
    resp = client.delete(f"/api/users/{admin2_id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204


def test_non_primary_admin_cannot_delete_admin(client: TestClient):
    """A non-primary admin cannot delete other admins."""
    primary_token = _create_admin(client)
    # Primary admin creates a regular admin
    create_resp = client.post(
        "/api/users",
        json={"username": "reg_admin", "password": "pass1234", "role": "admin"},
        headers={"Authorization": f"Bearer {primary_token}"},
    )
    reg_admin_id = create_resp.json()["id"]

    # Regular admin logs in and tries to delete the primary admin
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    from app.core.security import create_access_token

    db = next(app.dependency_overrides[get_db]())
    primary_user = db.query(User).filter(User.username == "admin1").first()
    reg_token = create_access_token({"sub": str(reg_admin_id)})
    resp = client.delete(
        f"/api/users/{primary_user.id}",
        headers={"Authorization": f"Bearer {reg_token}"},
    )
    assert resp.status_code == 400


def test_delete_last_admin_returns_400(client: TestClient):
    """Cannot delete the only remaining admin."""
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    from app.core.security import create_access_token, hash_password

    db = next(app.dependency_overrides[get_db]())
    primary = User(username="admin", password_hash=hash_password("x"), role="admin")
    db.add(primary)
    db.commit()
    db.refresh(primary)
    token = create_access_token({"sub": str(primary.id)})

    resp = client.delete(f"/api/users/{primary.id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_delete_nonexistent_user_returns_404(client: TestClient):
    token = _create_admin(client)
    resp = client.delete("/api/users/99999", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


def test_delete_unauthenticated_returns_401(client: TestClient):
    resp = client.delete("/api/users/1")
    assert resp.status_code == 401
