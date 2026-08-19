"""幂等 schema 升级：补齐按用户隔离工作目录所需的列与约束。"""
from sqlalchemy import text


def _has_single_col_unique(engine, table: str, column: str) -> bool:
    with engine.connect() as conn:
        for row in conn.execute(text(f"PRAGMA index_list({table})")):
            if row[2] != 1:  # not unique
                continue
            cols = [r[2] for r in conn.execute(text(f"PRAGMA index_info({row[1]})"))]
            if cols == [column]:
                return True
    return False


def _rebuild_batches(engine) -> None:
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys = OFF")
        cur.execute("BEGIN")
        cur.execute("""
            CREATE TABLE batches__new (
                id INTEGER NOT NULL PRIMARY KEY,
                name VARCHAR(256) NOT NULL,
                source VARCHAR(16) NOT NULL DEFAULT 'upload',
                created_by INTEGER,
                note VARCHAR(1024) NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL,
                CONSTRAINT uq_batches_created_by_name UNIQUE (created_by, name),
                FOREIGN KEY(created_by) REFERENCES users (id)
            )
        """)
        cur.execute("""
            INSERT INTO batches__new (id, name, source, created_by, note, created_at)
            SELECT id, name, source, created_by, note, created_at FROM batches
        """)
        cur.execute("DROP TABLE batches")
        cur.execute("ALTER TABLE batches__new RENAME TO batches")
        cur.execute("CREATE INDEX ix_batches_name ON batches (name)")
        cur.execute("CREATE INDEX ix_batches_created_by ON batches (created_by)")
        cur.execute("COMMIT")
        cur.execute("PRAGMA foreign_keys = ON")
        raw.commit()
    finally:
        raw.close()


def run_migrations(engine) -> None:
    # 1) users.work_dir 列
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
        if "work_dir" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN work_dir VARCHAR(1024)"))

    # 2) batches 唯一约束：旧库仍是对单列 name 的全局唯一 → 重建为 (created_by, name)
    if _has_single_col_unique(engine, "batches", "name"):
        _rebuild_batches(engine)

    # 3) 旧数据归属回填给第一个 admin
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE batches SET created_by = "
            "(SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) "
            "WHERE created_by IS NULL"
        ))
