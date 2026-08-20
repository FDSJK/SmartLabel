import sqlite3
from sqlalchemy import create_engine, text
from app.core.migrations import run_migrations


def _make_pre_v2_db(path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("""CREATE TABLE users (
        id INTEGER NOT NULL PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(128) NOT NULL, role VARCHAR(16) NOT NULL,
        is_active BOOLEAN NOT NULL, created_at DATETIME NOT NULL)""")
    cur.execute("""CREATE TABLE batches (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR(256) NOT NULL UNIQUE,
        source VARCHAR(16) NOT NULL, created_by INTEGER, note VARCHAR(1024) NOT NULL,
        created_at DATETIME NOT NULL, FOREIGN KEY(created_by) REFERENCES users(id))""")
    cur.execute("""CREATE TABLE images (
        id INTEGER NOT NULL PRIMARY KEY, batch_id INTEGER NOT NULL,
        file_name VARCHAR(512) NOT NULL, src_rel_path VARCHAR(1024) NOT NULL,
        work_rel_path VARCHAR(1024), width INTEGER NOT NULL, height INTEGER NOT NULL,
        channels INTEGER NOT NULL, status VARCHAR(16) NOT NULL,
        locked_by INTEGER, locked_at DATETIME, annotation_rev INTEGER NOT NULL,
        created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES batches(id))""")
    cur.execute("INSERT INTO users (id, username, password_hash, role, is_active, created_at) "
                "VALUES (1, 'admin', 'x', 'admin', 1, '2026-01-01')")
    cur.execute("INSERT INTO batches (id, name, source, created_by, note, created_at) "
                "VALUES (1, 'b1', 'scan', NULL, '', '2026-01-01')")
    conn.commit()
    conn.close()


def test_migrations_upgrade_pre_v2(tmp_path):
    path = str(tmp_path / "old.db")
    _make_pre_v2_db(path)
    engine = create_engine(f"sqlite:///{path}")

    run_migrations(engine)

    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(users)"))]
        assert "work_dir" in cols
        assert conn.execute(text("SELECT created_by FROM batches WHERE id=1")).scalar() == 1
        conn.execute(text(
            "INSERT INTO users (id, username, password_hash, role, is_active, created_at) "
            "VALUES (2, 'ann', 'x', 'annotator', 1, '2026-01-01')"))
        conn.execute(text(
            "INSERT INTO batches (id, name, source, created_by, note, created_at) "
            "VALUES (2, 'b1', 'scan', 2, '', '2026-01-01')"))
        conn.commit()
    engine.dispose()


def test_migrations_idempotent(tmp_path):
    path = str(tmp_path / "old.db")
    _make_pre_v2_db(path)
    engine = create_engine(f"sqlite:///{path}")
    run_migrations(engine)
    run_migrations(engine)  # 第二次不应抛错
    engine.dispose()


def test_startup_migrates_old_db(tmp_path, monkeypatch):
    """老库（无 work_dir 列）启动时应先迁移、再执行 admin 查询，不报错。"""
    _make_pre_v2_db(str(tmp_path / "metadata.db"))

    from app.core.config import Settings
    from app.main import app
    monkeypatch.setattr("app.main.settings", Settings(WORK_DIR=str(tmp_path), SECRET_KEY="test"))

    from fastapi.testclient import TestClient
    with TestClient(app):  # 触发 lifespan，应不抛异常
        pass

    engine = create_engine(f"sqlite:///{tmp_path}/metadata.db")
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(users)"))]
        assert "work_dir" in cols
    engine.dispose()
