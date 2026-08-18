import json
import os
import numpy as np
from PIL import Image as PILImage
from fastapi.testclient import TestClient

from app.services.mask_import import import_batch_masks


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


def _session():
    from app.main import app
    from app.core.db import get_db
    return next(app.dependency_overrides[get_db]())


def _make_image(tmp_work_dir, name="b1", fname="a.png", size=64):
    images_dir = os.path.join(tmp_work_dir, "batches", name, "images")
    os.makedirs(images_dir)
    img = PILImage.fromarray(np.zeros((size, size, 3), dtype=np.uint8))
    img.save(os.path.join(images_dir, fname))
    return images_dir


def _make_mask(tmp_work_dir, batch="b1", label="cat", fname="a.png", size=64, val=255):
    d = os.path.join(tmp_work_dir, "batches", batch, "masks", label)
    os.makedirs(d, exist_ok=True)
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[size // 4: 3 * size // 4, size // 4: 3 * size // 4] = val
    PILImage.fromarray(mask).save(os.path.join(d, fname))


def test_import_writes_json_and_creates_label(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))
    _make_mask(tmp_work_dir)

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["imported"] == 1
    assert result["created_labels"] == ["cat"]

    json_path = os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")
    data = json.load(open(json_path))
    assert data["version"] == 1
    assert data["labelStatus"] == {"cat": "present"}
    assert len(data["shapes"]) == 1
    assert data["shapes"][0]["label"] == "cat"
    assert data["shapes"][0]["shapeType"] == "polygon"
    assert len(data["shapes"][0]["points"]) >= 3

    from app.models.label import Label
    assert db.query(Label).filter(Label.name == "cat").count() == 1
    db.close()


def test_import_skips_nonempty_annotation(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    # 预置一个已有 shapes 的 sidecar JSON
    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        json.dump({"version": 3, "shapes": [{"id": "x", "label": "cat",
                  "shapeType": "polygon", "points": [[0, 0], [1, 0], [1, 1]]}],
                  "labelStatus": {}}, f)
    _make_mask(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["skipped"] == 1
    assert result["imported"] == 0
    data = json.load(open(os.path.join(annot_dir, "a.json")))
    assert data["version"] == 3  # 未被改动
    db.close()


def test_import_backfills_absent_for_existing_annotation(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))

    # 已有 shapes 的 sidecar JSON（cat present），dog 为全黑 mask
    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        json.dump({"version": 5, "shapes": [{"id": "x", "label": "cat",
                  "shapeType": "polygon", "points": [[0, 0], [1, 0], [1, 1]]}],
                  "labelStatus": {"cat": "present"}}, f)
    _make_mask(tmp_work_dir, label="cat", val=255)   # 非全黑
    _make_mask(tmp_work_dir, label="dog", val=0)     # 全黑 → 应补 absent

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["skipped"] == 1
    assert result["imported"] == 0

    data = json.load(open(os.path.join(annot_dir, "a.json")))
    assert data["version"] == 6  # 补标触发 +1
    assert data["labelStatus"] == {"cat": "present", "dog": "absent"}
    assert len(data["shapes"]) == 1  # 原有 shape 未动
    assert data["shapes"][0]["label"] == "cat"
    db.close()


def test_import_backfills_pending_to_absent(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))

    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a.json"), "w") as f:
        json.dump({"version": 5, "shapes": [{"id": "x", "label": "cat",
                  "shapeType": "polygon", "points": [[0, 0], [1, 0], [1, 1]]}],
                  "labelStatus": {"cat": "present", "dog": "pending"}}, f)
    _make_mask(tmp_work_dir, label="cat", val=255)
    _make_mask(tmp_work_dir, label="dog", val=0)  # 全黑，但旧状态是 pending

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    import_batch_masks(tmp_work_dir, batch, db, username="test")

    data = json.load(open(os.path.join(annot_dir, "a.json")))
    assert data["labelStatus"] == {"cat": "present", "dog": "absent"}
    db.close()


def test_import_logs_size_mismatch(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, size=64)
    _make_mask(tmp_work_dir, size=32)  # 尺寸不符
    client.post("/api/batches/scan", headers=_auth(token))

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["imported"] == 0
    assert len(result["errors"]) == 1
    assert not os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json"))
    db.close()


def test_import_donut_writes_holes(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))

    # 环形 mask：外框填充 + 中间挖洞（scan 之后创建，避免被 scan 自动导入）
    d = os.path.join(tmp_work_dir, "batches", "b1", "masks", "cat")
    os.makedirs(d)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[16:48, 16:48] = 255
    mask[28:36, 28:36] = 0
    PILImage.fromarray(mask).save(os.path.join(d, "a.png"))

    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["imported"] == 1
    data = json.load(open(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")))
    sh = data["shapes"][0]
    assert len(sh["points"]) >= 4
    assert len(sh["holes"]) == 1
    assert len(sh["holes"][0]) >= 4
    db.close()


def test_import_empty_mask_marks_absent(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))
    _make_mask(tmp_work_dir, val=0)  # 全黑 mask
    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["imported"] == 1
    data = json.load(open(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")))
    assert data["shapes"] == []
    assert data["labelStatus"] == {"cat": "absent"}
    db.close()


def test_import_partial_labels_present_and_pending(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))
    _make_mask(tmp_work_dir, label="cat", val=255)  # 只有 cat 有 mask
    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    import_batch_masks(tmp_work_dir, batch, db, username="test")
    data = json.load(open(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")))
    # dog 没有 mask 文件 → 不在 labelStatus → 前端视为 pending
    assert data["labelStatus"] == {"cat": "present"}
    db.close()
