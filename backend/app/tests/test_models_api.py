def _admin_token(client):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=settings.WORK_DIR)
    db.add(user); db.commit(); db.refresh(user)
    db.close()
    return create_access_token({"sub": str(user.id)})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_model(client):
    token = _admin_token(client)
    body = {"name": "unet", "source": "path", "model_path": "/tmp/x.onnx",
            "categories": [{"label": "cat", "channel": 1}], "background_channel": 0}
    r = client.post("/api/models", json=body, headers=_auth(token))
    assert r.status_code == 201
    assert r.json()["background_channel"] == 0
    lst = client.get("/api/models", headers=_auth(token)).json()
    assert len(lst) == 1


def test_create_model_requires_admin(client):
    r = client.post("/api/auth/register", json={"username": "ann", "password": "pass1234"})
    token = r.json()["access_token"]
    body = {"name": "m", "source": "path", "model_path": "/x.onnx"}
    assert client.post("/api/models", json=body, headers=_auth(token)).status_code == 403


def test_upload_onnx(client, tmp_work_dir, monkeypatch):
    token = _admin_token(client)
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    r = client.post("/api/models/upload",
                    files={"file": ("m.onnx", b"fakebytes", "application/octet-stream")},
                    headers=_auth(token))
    assert r.status_code == 200
    import os
    assert os.path.isfile(os.path.join(tmp_work_dir, r.json()["filename"]))


def test_upload_onnx_duplicate_conflict(client, tmp_work_dir, monkeypatch):
    token = _admin_token(client)
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    import os
    files = {"file": ("m.onnx", b"fakebytes", "application/octet-stream")}
    assert client.post("/api/models/upload", files=files, headers=_auth(token)).status_code == 200
    r2 = client.post("/api/models/upload", files=files, headers=_auth(token))
    assert r2.status_code == 409
    assert "已存在" in r2.json()["detail"]
    # 不生成随机串文件，只有原始文件
    others = [f for f in os.listdir(tmp_work_dir) if f.startswith("m_") and f.endswith(".onnx")]
    assert others == []
    assert os.path.isfile(os.path.join(tmp_work_dir, "m.onnx"))


def test_update_model_name_conflict_409(client):
    token = _admin_token(client)
    b1 = {"name": "m1", "source": "path", "model_path": "/x1.onnx"}
    b2 = {"name": "m2", "source": "path", "model_path": "/x2.onnx"}
    id1 = client.post("/api/models", json=b1, headers=_auth(token)).json()["id"]
    client.post("/api/models", json=b2, headers=_auth(token))
    r = client.put(f"/api/models/{id1}", json={**b1, "name": "m2"}, headers=_auth(token))
    assert r.status_code == 409


def test_delete_upload_model_removes_onnx(client, tmp_work_dir, monkeypatch):
    token = _admin_token(client)
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    import os
    onnx_path = os.path.join(tmp_work_dir, "m.onnx")
    with open(onnx_path, "wb") as f:
        f.write(b"fake")
    body = {"name": "up1", "source": "upload", "model_path": "m.onnx",
            "categories": [{"label": "cat", "channel": 1}], "background_channel": 0}
    mid = client.post("/api/models", json=body, headers=_auth(token)).json()["id"]
    r = client.delete(f"/api/models/{mid}", headers=_auth(token))
    assert r.status_code == 204
    assert not os.path.exists(onnx_path)


def test_delete_upload_model_shared_file_keeps_onnx(client, tmp_work_dir, monkeypatch):
    token = _admin_token(client)
    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    import os
    onnx_path = os.path.join(tmp_work_dir, "m.onnx")
    with open(onnx_path, "wb") as f:
        f.write(b"fake")
    base = {"source": "upload", "model_path": "m.onnx",
            "categories": [{"label": "cat", "channel": 1}], "background_channel": 0}
    id1 = client.post("/api/models", json={**base, "name": "a"}, headers=_auth(token)).json()["id"]
    id2 = client.post("/api/models", json={**base, "name": "b"}, headers=_auth(token)).json()["id"]
    assert client.delete(f"/api/models/{id1}", headers=_auth(token)).status_code == 204
    assert os.path.exists(onnx_path)
    # 删掉最后一个共用配置后，文件才应被删除
    assert client.delete(f"/api/models/{id2}", headers=_auth(token)).status_code == 204
    assert not os.path.exists(onnx_path)


def test_delete_path_model_keeps_server_file(client, tmp_work_dir):
    token = _admin_token(client)
    import os
    onnx_path = os.path.join(tmp_work_dir, "server.onnx")
    with open(onnx_path, "wb") as f:
        f.write(b"fake")
    body = {"name": "sp", "source": "path", "model_path": onnx_path,
            "categories": [{"label": "cat", "channel": 1}], "background_channel": 0}
    mid = client.post("/api/models", json=body, headers=_auth(token)).json()["id"]
    r = client.delete(f"/api/models/{mid}", headers=_auth(token))
    assert r.status_code == 204
    assert os.path.exists(onnx_path)


def test_delete_model_with_inference_jobs(client, tmp_work_dir, monkeypatch):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.models.batch import Batch
    from app.models.image import Image
    from app.models.model_config import ModelConfig
    from app.models.inference_job import InferenceJob
    from app.main import app
    from app.core.db import get_db

    monkeypatch.setattr("app.core.config.settings.MODELS_DIR", tmp_work_dir)
    import os
    onnx_path = os.path.join(tmp_work_dir, "m.onnx")
    with open(onnx_path, "wb") as f:
        f.write(b"fake")

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin2", password_hash=hash_password("admin1234"), role="admin", work_dir=tmp_work_dir)
    db.add(user); db.commit(); db.refresh(user)
    user_id = user.id
    batch = Batch(name="b1", created_by=user_id)
    db.add(batch); db.commit(); db.refresh(batch)
    batch_id = batch.id
    image = Image(batch_id=batch_id, file_name="a.png", src_rel_path="a.png")
    db.add(image); db.commit(); db.refresh(image)
    image_id = image.id
    cfg = ModelConfig(name="up2", source="upload", model_path="m.onnx",
                      categories=[{"label": "cat", "channel": 1}])
    db.add(cfg); db.commit(); db.refresh(cfg)
    cfg_id = cfg.id
    db.add(InferenceJob(image_id=image_id, model_config_id=cfg_id, requested_by=user_id))
    db.commit()
    db.close()

    token = create_access_token({"sub": str(user_id)})
    r = client.delete(f"/api/models/{cfg_id}", headers=_auth(token))
    assert r.status_code == 204
    assert not os.path.exists(onnx_path)

    # 历史推理任务一并删除，外键不再卡住删除
    db2 = next(app.dependency_overrides[get_db]())
    assert db2.query(InferenceJob).filter(InferenceJob.model_config_id == cfg_id).count() == 0
    db2.close()
