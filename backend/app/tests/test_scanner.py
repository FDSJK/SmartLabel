import os
from PIL import Image as PILImage
import numpy as np
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


def test_scan_discovers_images(client: TestClient, tmp_work_dir: str):
    token = _admin_token(client)

    batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch", "images")
    os.makedirs(batches_dir)
    img = PILImage.fromarray(np.zeros((100, 100, 3), dtype=np.uint8) + 128)
    img.save(os.path.join(batches_dir, "sample.png"))

    resp = client.post("/api/batches/scan", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["added"] == 1


def test_scan_skips_existing(client: TestClient, tmp_work_dir: str):
    token = _admin_token(client)

    batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch2", "images")
    os.makedirs(batches_dir)
    img = PILImage.fromarray(np.zeros((50, 50, 3), dtype=np.uint8))
    img.save(os.path.join(batches_dir, "existing.png"))

    r1 = client.post("/api/batches/scan", headers=_auth(token))
    assert r1.json()["added"] == 1

    r2 = client.post("/api/batches/scan", headers=_auth(token))
    assert r2.json()["added"] == 0
    assert r2.json()["skipped"] == 1


def test_scan_creates_batch_automatically(client: TestClient, tmp_work_dir: str):
    token = _admin_token(client)

    batches_dir = os.path.join(tmp_work_dir, "batches", "auto-batch", "images")
    os.makedirs(batches_dir)
    img = PILImage.fromarray(np.zeros((10, 10, 3), dtype=np.uint8))
    img.save(os.path.join(batches_dir, "img.png"))

    client.post("/api/batches/scan", headers=_auth(token))

    # Verify batch was created
    resp = client.get("/api/batches", headers=_auth(token))
    batches = resp.json()
    names = [b["name"] for b in batches]
    assert "auto-batch" in names
