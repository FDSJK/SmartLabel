import os
import numpy as np
from PIL import Image as PILImage
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _setup_admin_and_model(client, tmp_work_dir):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.models.model_config import ModelConfig
    from app.main import app
    from app.core.db import get_db

    db = next(app.dependency_overrides[get_db]())
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=tmp_work_dir)
    db.add(user); db.commit(); db.refresh(user)
    user_id = user.id
    cfg = ModelConfig(name="m", source="path", model_path="/x.onnx",
                      categories=[{"label": "cat", "channel": 1}])
    db.add(cfg); db.commit(); db.refresh(cfg)
    cfg_id = cfg.id
    db.close()
    token = create_access_token({"sub": str(user_id)})
    return {"Authorization": f"Bearer {token}"}, cfg_id


def _make_image_and_scan(client, tmp_work_dir, auth):
    os.makedirs(os.path.join(tmp_work_dir, "batches", "b1", "images"))
    PILImage.fromarray(np.zeros((16, 16, 3), dtype=np.uint8)).save(
        os.path.join(tmp_work_dir, "batches", "b1", "images", "a.png"))
    client.post("/api/batches/scan", headers=auth)
    batch_id = client.get("/api/batches", headers=auth).json()[0]["id"]
    img_id = client.get(f"/api/batches/{batch_id}/images", headers=auth).json()[0]["id"]
    return img_id


def test_trigger_single_writes_draft(client, tmp_work_dir, monkeypatch):
    auth, model_id = _setup_admin_and_model(client, tmp_work_dir)
    img_id = _make_image_and_scan(client, tmp_work_dir, auth)

    # 后台任务用测试库 session（绑定同一 sqlite 文件）
    import app.core.db as _db
    engine = create_engine(f"sqlite:///{tmp_work_dir}/metadata.db", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    monkeypatch.setattr(_db, "_SessionLocal", TestingSession)

    # mock 推理，避免加载真实 ONNX
    from app.services import onnx_service
    monkeypatch.setattr(onnx_service, "run_inference",
                        lambda cfg, path: [{"id": "x", "label": "cat", "shapeType": "polygon",
                                            "points": [[0, 0], [1, 0], [1, 1]], "holes": []}])

    r = client.post(f"/api/models/{model_id}/inference/{img_id}", headers=auth)
    assert r.status_code == 200
    job_id = r.json()["jobId"]

    # TestClient 会同步执行 BackgroundTasks → job 应已 done
    job = client.get(f"/api/inference-jobs/{job_id}", headers=auth).json()
    assert job["status"] == "done"
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "drafts", "a.json"))


def test_trigger_batch_queues_jobs(client, tmp_work_dir, monkeypatch):
    auth, model_id = _setup_admin_and_model(client, tmp_work_dir)
    _make_image_and_scan(client, tmp_work_dir, auth)

    # 批量只验证排队的 job 数量；mock _run_job 为空避免后台执行
    from app.api import inference
    monkeypatch.setattr(inference, "_run_job", lambda job_id: None)

    batch_id = client.get("/api/batches", headers=auth).json()[0]["id"]
    r = client.post(f"/api/models/{model_id}/inference/batch/{batch_id}", headers=auth)
    assert r.status_code == 200
    assert r.json()["queued"] == 1
    assert len(r.json()["jobIds"]) == 1
