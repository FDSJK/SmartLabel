import json
import os

from app.services.stats import compute_stats


def _session():
    from app.main import app
    from app.core.db import get_db
    return next(app.dependency_overrides[get_db]())


def _admin_token(client):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    db = _session()
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()
    return create_access_token({"sub": str(user_id)}), user_id


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _seed(tmp_work_dir, created_by=None):
    """批次 b1 + 2 标签 + 3 图 + 不同 labelStatus 的 sidecar。"""
    from app.models.batch import Batch
    from app.models.image import Image
    from app.models.label import Label
    db = _session()
    db.add(Batch(name="b1", source="upload", created_by=created_by))
    db.add(Label(name="cat", color="#f00", sort_order=0))
    db.add(Label(name="dog", color="#0f0", sort_order=1))
    db.commit()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    for i in range(3):
        db.add(Image(batch_id=batch.id, file_name=f"a{i}.png",
                     src_rel_path=f"batches/b1/images/a{i}.png", width=20, height=20, channels=3))
    db.commit()
    db.close()

    annot_dir = os.path.join(tmp_work_dir, "batches", "b1", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "a0.json"), "w") as f:
        json.dump({"version": 1, "shapes": [], "labelStatus": {"cat": "present", "dog": "absent"}}, f)
    with open(os.path.join(annot_dir, "a1.json"), "w") as f:
        json.dump({"version": 1, "shapes": [], "labelStatus": {"cat": "absent", "dog": "pending"}}, f)
    # a2 无 sidecar → 全部 pending

    # 批次 b2：1 张图，cat/dog 均 present（用于验证批次隔离）
    from app.models.batch import Batch as _Batch
    from app.models.image import Image as _Image
    db = _session()
    b2 = _Batch(name="b2", source="upload", created_by=created_by)
    db.add(b2)
    db.commit()
    db.add(_Image(batch_id=b2.id, file_name="b0.png",
                  src_rel_path="batches/b2/images/b0.png", width=20, height=20, channels=3))
    db.commit()
    db.close()
    annot_dir2 = os.path.join(tmp_work_dir, "batches", "b2", "annotations")
    os.makedirs(annot_dir2)
    with open(os.path.join(annot_dir2, "b0.json"), "w") as f:
        json.dump({"version": 1, "shapes": [], "labelStatus": {"cat": "present", "dog": "present"}}, f)


def _batch_id():
    from app.models.batch import Batch
    db = _session()
    bid = db.query(Batch).filter(Batch.name == "b1").one().id
    db.close()
    return bid


def test_compute_stats_global(client, tmp_work_dir):
    _seed(tmp_work_dir)
    db = _session()
    result = compute_stats(tmp_work_dir, db, None)
    db.close()
    assert result["total_images"] == 4
    by_name = {l["name"]: l for l in result["labels"]}
    assert by_name["cat"] == {"name": "cat", "present": 2, "absent": 1, "pending": 1}
    assert by_name["dog"] == {"name": "dog", "present": 1, "absent": 1, "pending": 2}


def test_compute_stats_batch(client, tmp_work_dir):
    _seed(tmp_work_dir)
    db = _session()
    result = compute_stats(tmp_work_dir, db, _batch_id())
    db.close()
    assert result["total_images"] == 3  # 只含 b1，不含 b2
    by_name = {l["name"]: l for l in result["labels"]}
    assert by_name["cat"]["present"] == 1  # b2 的 cat present 不计入
    assert by_name["dog"]["present"] == 0


def test_stats_endpoint(client, tmp_work_dir):
    token, admin_id = _admin_token(client)
    _seed(tmp_work_dir, created_by=admin_id)
    res = client.get("/api/stats", headers=_auth(token))
    assert res.status_code == 200
    body = res.json()
    assert body["totalImages"] == 4
    by_name = {l["name"]: l for l in body["labels"]}
    assert by_name["cat"] == {"name": "cat", "present": 2, "absent": 1, "pending": 1}

    res2 = client.get(f"/api/stats?batch_id={_batch_id()}", headers=_auth(token))
    assert res2.status_code == 200
    body2 = res2.json()
    assert body2["totalImages"] == 3
    by_name2 = {l["name"]: l for l in body2["labels"]}
    assert by_name2["cat"]["present"] == 1


def test_compute_stats_non_dict_label_status(client, tmp_work_dir):
    from app.models.batch import Batch
    from app.models.image import Image
    from app.models.label import Label
    db = _session()
    db.add(Batch(name="b3", source="upload"))
    db.add(Label(name="cat", color="#f00", sort_order=0))
    db.commit()
    batch = db.query(Batch).filter(Batch.name == "b3").one()
    db.add(Image(batch_id=batch.id, file_name="x.png",
                 src_rel_path="batches/b3/images/x.png", width=20, height=20, channels=3))
    db.commit()
    db.close()

    annot_dir = os.path.join(tmp_work_dir, "batches", "b3", "annotations")
    os.makedirs(annot_dir)
    with open(os.path.join(annot_dir, "x.json"), "w") as f:
        json.dump({"version": 1, "shapes": [], "labelStatus": None}, f)

    db = _session()
    result = compute_stats(tmp_work_dir, db, None)  # 不应抛异常
    db.close()
    by_name = {l["name"]: l for l in result["labels"]}
    assert by_name["cat"] == {"name": "cat", "present": 0, "absent": 0, "pending": 1}


def test_stats_endpoint_isolated_per_user(client, tmp_work_dir):
    # 用户 A 有数据，用户 B 无 → B 的 totalImages 为 0
    from app.models.user import User
    from app.core.security import hash_password, create_access_token
    db = _session()
    a = User(username="stat_a", password_hash=hash_password("x"), role="annotator")
    db.add(a); db.commit(); db.refresh(a)
    a_id = a.id
    db.close()
    _seed(tmp_work_dir, created_by=a_id)
    token_a = create_access_token({"sub": str(a_id)})
    # B
    db = _session()
    b = User(username="stat_b", password_hash=hash_password("x"), role="annotator")
    db.add(b); db.commit(); db.refresh(b)
    b_id = b.id
    db.close()
    token_b = create_access_token({"sub": str(b_id)})
    assert client.get("/api/stats", headers=_auth(token_a)).json()["totalImages"] == 4
    assert client.get("/api/stats", headers=_auth(token_b)).json()["totalImages"] == 0
