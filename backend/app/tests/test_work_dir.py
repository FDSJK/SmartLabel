import app.core.config as _config
from app.models.user import User
from app.models.setting import Setting
from app.services.work_dir import get_work_dir
from app.main import app
from app.core.db import get_db


def test_work_dir_user_priority(client):
    db = next(app.dependency_overrides[get_db]())
    user = User(username="w1", password_hash="x", role="annotator", work_dir="/u1")
    db.add(user); db.commit(); db.refresh(user)
    db.add(Setting(key="WORK_DIR", value="/global")); db.commit()
    assert get_work_dir(db, user) == "/u1"
    db.close()


def test_work_dir_falls_back_to_global(client):
    db = next(app.dependency_overrides[get_db]())
    user = User(username="w2", password_hash="x", role="annotator", work_dir=None)
    db.add(user); db.commit(); db.refresh(user)
    db.add(Setting(key="WORK_DIR", value="/global")); db.commit()
    assert get_work_dir(db, user) == "/global"
    db.close()


def test_work_dir_falls_back_to_env(client):
    db = next(app.dependency_overrides[get_db]())
    user = User(username="w3", password_hash="x", role="annotator", work_dir=None)
    db.add(user); db.commit(); db.refresh(user)
    assert get_work_dir(db, user) == _config.settings.WORK_DIR
    db.close()
