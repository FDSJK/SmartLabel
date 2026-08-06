import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import Settings
from app.core.db import Base, get_db


@pytest.fixture
def tmp_work_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def test_settings(tmp_work_dir):
    return Settings(
        WORK_DIR=tmp_work_dir,
        SECRET_KEY="test-secret",
    )


@pytest.fixture
def app(test_settings, monkeypatch):
    monkeypatch.setattr("app.core.config.settings", test_settings)
    from app.main import app as _app
    engine = create_engine(f"sqlite:///{test_settings.WORK_DIR}/metadata.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    _app.dependency_overrides[get_db] = override_get_db
    return _app


@pytest.fixture
def client(app):
    return TestClient(app)
