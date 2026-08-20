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
        json={"username": "u1", "password": "pass1234"},
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
        json={"username": "dup", "password": "pass1234"},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = client.post(
        "/api/users",
        json={"username": "dup", "password": "pass1234"},
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
        json={"username": "u2", "password": "pass1234"},
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = create_resp.json()["id"]
    resp = client.put(
        f"/api/users/{user_id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_active"] is False


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
        json={"username": "del_me", "password": "pass1234"},
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


def test_update_work_dir_reconciles_batches(client, tmp_work_dir):
    import os
    token = _create_admin(client)
    from app.main import app
    from app.core.db import get_db
    from app.models.user import User
    from app.models.batch import Batch

    db = next(app.dependency_overrides[get_db]())
    admin = db.query(User).filter(User.username == "admin1").one()
    db.add(Batch(name="old-batch", source="upload", created_by=admin.id))
    db.commit()
    db.close()

    new_dir = os.path.join(tmp_work_dir, "new-empty")
    os.makedirs(new_dir, exist_ok=True)
    h = {"Authorization": f"Bearer {token}"}
    resp = client.put("/api/users/me/work_dir", json={"work_dir": new_dir}, headers=h)
    assert resp.status_code == 200

    r = client.get("/api/batches", headers=h)
    assert r.json() == []


def test_create_user_cannot_be_admin(client):
    token = _create_admin(client)
    resp = client.post(
        "/api/users",
        json={"username": "noadmin", "password": "pass1234", "role": "admin"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "annotator"


def test_update_user_cannot_change_role(client):
    token = _create_admin(client)
    create = client.post("/api/users", json={"username": "ur", "password": "pass1234"},
                         headers={"Authorization": f"Bearer {token}"})
    uid = create.json()["id"]
    resp = client.put(f"/api/users/{uid}", json={"role": "admin"},
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "annotator"


def test_me_work_dir_roundtrip(client):
    resp = client.post("/api/auth/register", json={"username": "me1", "password": "pass1234"})
    token = resp.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/users/me", headers=h)
    assert r.json()["work_dir"] is None
    r = client.put("/api/users/me/work_dir", json={"work_dir": "/home/me1"}, headers=h)
    assert r.status_code == 200 and r.json()["work_dir"] == "/home/me1"
    assert client.get("/api/users/me", headers=h).json()["work_dir"] == "/home/me1"
