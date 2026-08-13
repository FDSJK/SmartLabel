import json
import os
import numpy as np
from PIL import Image as PILImage
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
    db.close()
    return create_access_token({"sub": str(user.id)})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_image(tmp_work_dir, batch, fname="a.png", size=32):
    d = os.path.join(tmp_work_dir, "batches", batch, "images")
    os.makedirs(d)
    PILImage.fromarray(np.zeros((size, size, 3), dtype=np.uint8)).save(os.path.join(d, fname))


def _make_mask(tmp_work_dir, batch, label="cat", fname="a.png", size=32):
    d = os.path.join(tmp_work_dir, "batches", batch, "masks", label)
    os.makedirs(d)
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[size // 4: 3 * size // 4, size // 4: 3 * size // 4] = 255
    PILImage.fromarray(mask).save(os.path.join(d, fname))


def test_scan_imports_masks(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, "b1")
    _make_mask(tmp_work_dir, "b1")
    resp = client.post("/api/batches/scan", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 1
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json"))


def test_import_masks_endpoint(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, "b2")
    client.post("/api/batches/scan", headers=_auth(token))
    # 此时还没有 mask → 无 JSON
    assert not os.path.isfile(os.path.join(tmp_work_dir, "batches", "b2", "annotations", "a.json"))

    _make_mask(tmp_work_dir, "b2")
    batches = client.get("/api/batches", headers=_auth(token)).json()
    b2 = next(b for b in batches if b["name"] == "b2")

    resp = client.post(f"/api/batches/{b2['id']}/import-masks", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["imported"] == 1
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b2", "annotations", "a.json"))

    # 幂等：再跑一次 → 全部 skipped
    resp2 = client.post(f"/api/batches/{b2['id']}/import-masks", headers=_auth(token))
    assert resp2.json()["imported"] == 0
    assert resp2.json()["skipped"] == 1


def test_scan_survives_corrupt_annotation(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, "b3")
    _make_mask(tmp_work_dir, "b3")
    # 预置一个损坏的 sidecar JSON
    annot_dir = os.path.join(tmp_work_dir, "batches", "b3", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        f.write("{ not valid json")
    resp = client.post("/api/batches/scan", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 0
    assert any("corrupt annotation" in e["error"] for e in data["errors"])
