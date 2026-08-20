import json
import os
import numpy as np
from PIL import Image as PILImage


def _admin_token(client):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=settings.WORK_DIR)
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return create_access_token({"sub": str(user.id)})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _session():
    from app.main import app
    from app.core.db import get_db
    return next(app.dependency_overrides[get_db]())


def _seed(client, tmp_work_dir):
    token = _admin_token(client)
    images_dir = os.path.join(tmp_work_dir, "batches", "b1", "images")
    os.makedirs(images_dir)
    PILImage.fromarray(np.zeros((20, 20, 3), dtype=np.uint8)).save(os.path.join(images_dir, "a.png"))
    client.post("/api/batches/scan", headers=_auth(token))

    from app.models.label import Label
    db = _session()
    for i, name in enumerate(["cat", "dog"]):
        if db.query(Label).filter(Label.name == name).count() == 0:
            db.add(Label(name=name, color="#3388ff", sort_order=i))
    db.commit()
    db.close()

    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        json.dump({"version": 1, "shapes": [], "labelStatus": {"cat": "present"}}, f)
    return token


def _batch_id():
    from app.models.batch import Batch
    db = _session()
    batch_id = db.query(Batch).filter(Batch.name == "b1").one().id
    db.close()
    return batch_id


def test_export_blocks_on_pending(client, tmp_work_dir):
    token = _seed(client, tmp_work_dir)
    res = client.post("/api/export", json={
        "scope": "batch", "batchId": _batch_id(),
        "formats": ["mask"], "skipUnconfirmed": False,
    }, headers=_auth(token))
    assert res.status_code == 409
    body = res.json()
    assert body["detail"]["code"] == "unconfirmed_labels"
    assert body["detail"]["pending"] == [{"image": "a.png", "labels": ["dog"]}]


def test_export_skip_pending_succeeds(client, tmp_work_dir):
    token = _seed(client, tmp_work_dir)
    res = client.post("/api/export", json={
        "scope": "batch", "batchId": _batch_id(),
        "formats": ["mask", "coco", "labelme"], "skipUnconfirmed": True,
    }, headers=_auth(token))
    assert res.status_code == 200
    body = res.json()
    assert body["pending"] == [{"image": "a.png", "labels": ["dog"]}]
    assert body["imageCount"] == 1
    assert body["maskCount"] == 1          # 仅 cat present（dog 缺失 → pending 跳过，不产 mask）
    assert body["exportDir"].startswith("export/")
    # 文件落地
    export_root = os.path.join(tmp_work_dir, body["exportDir"])
    assert os.path.isfile(os.path.join(export_root, "coco", "annotations.json"))
    assert os.path.isfile(os.path.join(export_root, "labelme", "a.json"))
    assert os.path.isfile(os.path.join(export_root, "masks", "cat", "a.png"))


def test_export_scope_image_requires_image_id(client, tmp_work_dir):
    token = _seed(client, tmp_work_dir)
    res = client.post("/api/export", json={
        "scope": "image", "imageId": None, "formats": ["mask"],
    }, headers=_auth(token))
    assert res.status_code == 422


def test_export_scope_image_404(client, tmp_work_dir):
    token = _seed(client, tmp_work_dir)
    res = client.post("/api/export", json={
        "scope": "image", "imageId": 9999, "formats": ["mask"], "skipUnconfirmed": True,
    }, headers=_auth(token))
    assert res.status_code == 404
