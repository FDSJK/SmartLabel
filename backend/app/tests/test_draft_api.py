import os
import json
import numpy as np
from PIL import Image as PILImage


def _setup(client, tmp_work_dir):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=tmp_work_dir)
    db.add(user); db.commit(); db.refresh(user)
    user_id = user.id
    db.close()
    token = create_access_token({"sub": str(user_id)})
    auth = {"Authorization": f"Bearer {token}"}

    os.makedirs(os.path.join(tmp_work_dir, "batches", "b1", "images"))
    PILImage.fromarray(np.zeros((16, 16, 3), dtype=np.uint8)).save(
        os.path.join(tmp_work_dir, "batches", "b1", "images", "a.png"))
    client.post("/api/batches/scan", headers=auth)
    batch_id = client.get("/api/batches", headers=auth).json()[0]["id"]
    img_id = client.get(f"/api/batches/{batch_id}/images", headers=auth).json()[0]["id"]
    return auth, img_id


def test_draft_lifecycle(client, tmp_work_dir):
    auth, img_id = _setup(client, tmp_work_dir)

    # 无草稿 → 404
    assert client.get(f"/api/images/{img_id}/draft", headers=auth).status_code == 404

    # 手工落一个草稿 JSON
    draft_dir = os.path.join(tmp_work_dir, "batches", "b1", "drafts")
    os.makedirs(draft_dir)
    draft = {"imageName": "a.png", "modelConfigId": 1, "modelName": "m", "createdAt": "now",
             "shapes": [{"id": "x", "label": "cat", "shapeType": "polygon",
                         "points": [[0, 0], [1, 0], [1, 1]], "holes": []}]}
    with open(os.path.join(draft_dir, "a.json"), "w") as f:
        json.dump(draft, f)

    # 读 → 200
    r = client.get(f"/api/images/{img_id}/draft", headers=auth)
    assert r.status_code == 200
    assert len(r.json()["shapes"]) == 1

    # 接受 → 合并进标注 + 标签置 present + 删草稿
    r = client.post(f"/api/images/{img_id}/draft/accept", json={"expectedRev": 0}, headers=auth)
    assert r.status_code == 200
    assert any(s["label"] == "cat" for s in r.json()["shapes"])
    assert r.json()["labelStatus"]["cat"] == "present"
    assert not os.path.isfile(os.path.join(draft_dir, "a.json"))

    # 接受后再读草稿 → 404（已删）
    assert client.get(f"/api/images/{img_id}/draft", headers=auth).status_code == 404


def test_draft_accept_overrides_same_label(client, tmp_work_dir):
    auth, img_id = _setup(client, tmp_work_dir)

    # 1) 先保存一个手工标注（cat）
    manual_shape = {"id": "manual1", "label": "cat", "shapeType": "polygon",
                    "points": [[0, 0], [1, 0], [1, 1]], "holes": []}
    r = client.put(f"/api/images/{img_id}/annotation", json={
        "expectedRev": 0, "shapes": [manual_shape], "labelStatus": {"cat": "present"},
    }, headers=auth)
    assert r.status_code == 200

    # 2) 落一个草稿（同标签 cat，不同 shape）
    draft_dir = os.path.join(tmp_work_dir, "batches", "b1", "drafts")
    os.makedirs(draft_dir)
    draft_shape = {"id": "draft1", "label": "cat", "shapeType": "polygon",
                   "points": [[5, 5], [6, 5], [6, 6]], "holes": []}
    with open(os.path.join(draft_dir, "a.json"), "w") as f:
        json.dump({"imageName": "a.png", "modelConfigId": 1, "modelName": "m",
                   "createdAt": "now", "shapes": [draft_shape]}, f)

    # 3) 接受 → 覆盖同标签手工标注（只剩 draft1，不叠加）
    r = client.post(f"/api/images/{img_id}/draft/accept", json={"expectedRev": 1}, headers=auth)
    assert r.status_code == 200
    shapes = r.json()["shapes"]
    assert len(shapes) == 1
    assert shapes[0]["id"] == "draft1"


def test_accept_rev_conflict_409(client, tmp_work_dir):
    auth, img_id = _setup(client, tmp_work_dir)
    draft_dir = os.path.join(tmp_work_dir, "batches", "b1", "drafts")
    os.makedirs(draft_dir)
    with open(os.path.join(draft_dir, "a.json"), "w") as f:
        json.dump({"imageName": "a.png", "modelConfigId": 1, "modelName": "m",
                   "createdAt": "now", "shapes": []}, f)
    r = client.post(f"/api/images/{img_id}/draft/accept", json={"expectedRev": 99}, headers=auth)
    assert r.status_code == 409
