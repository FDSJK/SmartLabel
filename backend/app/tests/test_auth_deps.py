from fastapi.testclient import TestClient


def test_protected_endpoint_without_token_returns_401(client: TestClient):
    resp = client.get("/api/users")
    assert resp.status_code == 401


def test_admin_endpoint_rejects_annotator(client: TestClient):
    # Register as annotator
    resp = client.post("/api/auth/register", json={"username": "ann1", "password": "pass1234"})
    token = resp.json()["access_token"]
    # Try to create user (admin only) — should 403
    resp = client.post(
        "/api/users",
        json={"username": "newguy", "password": "pass1234", "role": "annotator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
