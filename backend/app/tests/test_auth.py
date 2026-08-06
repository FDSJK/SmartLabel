def test_register_returns_token(client):
    resp = client.post("/api/auth/register", json={"username": "testuser", "password": "pass1234"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["username"] == "testuser"
    assert data["role"] == "annotator"


def test_register_duplicate_username_fails(client):
    client.post("/api/auth/register", json={"username": "dup", "password": "pass1234"})
    resp = client.post("/api/auth/register", json={"username": "dup", "password": "other5678"})
    assert resp.status_code == 409


def test_login_with_correct_credentials(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret99"})
    resp = client.post("/api/auth/login", json={"username": "alice", "password": "secret99"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "alice"


def test_login_wrong_password_fails(client):
    client.post("/api/auth/register", json={"username": "bob", "password": "correct"})
    resp = client.post("/api/auth/login", json={"username": "bob", "password": "wrong"})
    assert resp.status_code == 401


def test_login_inactive_user_fails(client, app):
    # Manually create and deactivate a user via DB
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.models.user import User
    from app.core.security import hash_password
    user = User(username="inactive", password_hash=hash_password("pass"), role="annotator", is_active=False)
    db.add(user)
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "inactive", "password": "pass"})
    assert resp.status_code == 401
