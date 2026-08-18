# 按用户隔离工作目录 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「admin 统一设置全局工作目录」改为「每个用户设置自己的工作目录」，数据（批次/图像/标注）按用户隔离，同时收紧用户管理权限（只保留一个 admin，只能新建标注员）。

**Architecture:** 共享一套 `metadata.db`（用户/登录/锁/标签/设置）。给 `User` 加 `work_dir` 字段，`Batch.created_by` 复用为归属人，`Batch.name` 唯一约束改为「同一归属人内唯一」。所有批次/图像/标注/统计/导出/扫描/上传接口按 `current_user` 过滤，并把数据操作接口从 `require_admin` 改为 `get_current_user`（人人可用、只操作自己的）。

**Tech Stack:** FastAPI + SQLAlchemy 2 + SQLite + Pydantic v2（后端）；React + Vite + TypeScript + Zustand（前端）。

**Spec:** `docs/superpowers/specs/2026-08-18-per-user-work-dir-design.md`

## Global Constraints

- 工作目录解析顺序（`get_work_dir(db, user)`）：`user.work_dir`（若设置）→ `settings.WORK_DIR`（旧全局）→ `config.settings.WORK_DIR`（env 默认 `./data`）。
- 归属判定统一为 `Batch.created_by == current_user.id`，**admin 也隔离**（无「看全部」监督视角），admin 只额外有「管理用户/标签」权限。
- 越权访问返回 **404**（不是 403），避免泄露他人数据存在性。
- 批次名唯一性：**同一 `created_by` 内唯一**（不同用户可同名）。
- `create_user` 固定 `role="annotator"`，不接受 role 入参；`update_user` 不接受 role 入参；系统只有一个 admin（启动时 `main.py` 创建）。
- 标签（`Label`）保持**全局共享**（admin 管理），不做按用户隔离。
- 旧数据兼容：`created_by IS NULL` 的批次迁移时归给 admin；用户未设 `work_dir` 时回退全局目录。
- 测试命令：后端 `cd backend && ../.venv/bin/pytest -q`；前端 `cd frontend && npx tsc --noEmit && npx vite build`。

---

### Task 1: 数据模型 + 迁移脚本

**Files:**
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/models/batch.py`
- Create: `backend/app/core/migrations.py`
- Modify: `backend/app/main.py`
- Create: `backend/app/tests/test_migrations.py`

**Interfaces:**
- Produces: `User.work_dir: str | None`；`Batch` 表唯一约束 `uq_batches_created_by_name (created_by, name)`；`run_migrations(engine)` 供 `main.py` 调用。

- [ ] **Step 1: 改 `User` 模型加 `work_dir` 字段**

```python
# backend/app/models/user.py — 在 created_at 之后加一列
    work_dir: Mapped[str | None] = mapped_column(String(1024), nullable=True)
```
（`String` 已在顶部 `from sqlalchemy import ... String ...` 导入。）

- [ ] **Step 2: 改 `Batch` 模型，唯一约束改为 (created_by, name)**

`backend/app/models/batch.py`：

```python
from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint
...
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)  # 去掉 unique=True

    __table_args__ = (UniqueConstraint("created_by", "name", name="uq_batches_created_by_name"),)
```

- [ ] **Step 3: 新建迁移脚本 `backend/app/core/migrations.py`**

```python
"""幂等 schema 升级：补齐按用户隔离工作目录所需的列与约束。"""
from sqlalchemy import text


def _has_single_col_unique(engine, table: str, column: str) -> bool:
    for row in engine.execute(text(f"PRAGMA index_list({table})")):
        if row[2] != 1:  # not unique
            continue
        cols = [r[2] for r in engine.execute(text(f"PRAGMA index_info({row[1]})"))]
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
    cols = [row[1] for row in engine.execute(text("PRAGMA table_info(users)"))]
    if "work_dir" not in cols:
        engine.execute(text("ALTER TABLE users ADD COLUMN work_dir VARCHAR(1024)"))

    # 2) batches 唯一约束：旧库仍是对单列 name 的全局唯一 → 重建为 (created_by, name)
    if _has_single_col_unique(engine, "batches", "name"):
        _rebuild_batches(engine)

    # 3) 旧数据归属回填给第一个 admin
    engine.execute(text(
        "UPDATE batches SET created_by = "
        "(SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) "
        "WHERE created_by IS NULL"
    ))
```

- [ ] **Step 4: 在 `main.py` lifespan 中调用迁移**

在 `backend/app/main.py` 的 `lifespan` 里，`Base.metadata.create_all(...)` **之后**、admin 创建逻辑之后（顺序无关紧要，但要在 engine 就绪后）加：

```python
from app.core.migrations import run_migrations
# ... 在 with DBSession(get_engine()) as db 的 admin 创建块之后 ...
    run_migrations(get_engine())
```

（放在 `yield` 之前即可。）

- [ ] **Step 5: 写迁移测试 `backend/app/tests/test_migrations.py`**

```python
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

    # work_dir 列已加
    cols = [r[1] for r in engine.execute(text("PRAGMA table_info(users)"))]
    assert "work_dir" in cols
    # 归属回填到 admin
    assert engine.execute(text("SELECT created_by FROM batches WHERE id=1")).scalar() == 1
    # 唯一约束已放宽：不同 owner 同名可共存
    engine.execute(text(
        "INSERT INTO users (id, username, password_hash, role, is_active, created_at) "
        "VALUES (2, 'ann', 'x', 'annotator', 1, '2026-01-01')"))
    engine.execute(text(
        "INSERT INTO batches (id, name, source, created_by, note, created_at) "
        "VALUES (2, 'b1', 'scan', 2, '', '2026-01-01')"))
    engine.dispose()


def test_migrations_idempotent(tmp_path):
    path = str(tmp_path / "old.db")
    _make_pre_v2_db(path)
    engine = create_engine(f"sqlite:///{path}")
    run_migrations(engine)
    run_migrations(engine)  # 第二次不应抛错
    engine.dispose()
```

- [ ] **Step 6: 运行测试验证**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_migrations.py -v`
Expected: PASS（3 个用例全绿；首次跑 `run_migrations` 后第二次幂等不报错）。

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/user.py backend/app/models/batch.py backend/app/core/migrations.py backend/app/main.py backend/app/tests/test_migrations.py
git commit -m "feat: add per-user work_dir model + migration"
```

---

### Task 2: 公共 `get_work_dir(db, user)` + 替换 5 处拷贝

**Files:**
- Create: `backend/app/services/work_dir.py`
- Modify: `backend/app/api/batches.py`, `backend/app/api/images.py`, `backend/app/api/annotations.py`, `backend/app/api/stats.py`, `backend/app/api/export.py`
- Create: `backend/app/tests/test_work_dir.py`

**Interfaces:**
- Produces: `get_work_dir(db, user) -> str`（`user` 为 `User` 对象或带 `work_dir` 属性的对象）。后续 Task 3/4/5 全部用它。

- [ ] **Step 1: 新建 `backend/app/services/work_dir.py`**

```python
import app.core.config as _config
from app.models.setting import Setting


def get_work_dir(db, user) -> str:
    """当前用户的工作目录。解析顺序：user.work_dir → settings.WORK_DIR → env 默认。"""
    if user is not None and getattr(user, "work_dir", None):
        v = user.work_dir.strip()
        if v:
            return v
    row = db.query(Setting).filter(Setting.key == "WORK_DIR").first()
    if row and row.value.strip():
        return row.value.strip()
    return _config.settings.WORK_DIR
```

- [ ] **Step 2: 替换 5 个路由里的 `_get_work_dir`**

在每个路由文件顶部加 `from app.services.work_dir import get_work_dir`，删除文件内各自的 `_get_work_dir` 定义与 `import app.core.config as _config`、`from app.models.setting import Setting`（若已不再被其他代码使用）。然后把 `_get_work_dir(db)` 的调用点改成 `get_work_dir(db, <user>)`：

- `batches.py`：`_get_work_dir(db)` 出现在 `delete_batch`、`trigger_scan`、`upload_images`、`import_masks`。这几个当前是 `require_admin`，本 Task 先用 `get_work_dir(db, admin)` 占位（admin 参数已在函数签名里）。
- `images.py`：`serve_image_file`（`_user`）、`export_mask`（`current_user`）→ `get_work_dir(db, current_user)` / `get_work_dir(db, _user)`。
- `annotations.py`：`get_annotation`（`_user`）、`save_annotation`（`current_user`）→ 对应 user。
- `stats.py`：`get_stats`（`_user`）→ `get_work_dir(db, _user)`。
- `export.py`：`export`（`current_user`）→ `get_work_dir(db, current_user)`。

> 本 Task 只做「抽公共函数 + 传对 user」，不引入归属过滤（Task 3/4 做）。此时所有用户 `work_dir` 均为 `None`，行为等价于旧的全局目录，不回归。

- [ ] **Step 3: 写 `backend/app/tests/test_work_dir.py`**

```python
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
```

（注：`client` fixture 已把 `app.dependency_overrides[get_db]` 指向测试库，这里直接用。）

- [ ] **Step 4: 运行全量测试确认无回归**

Run: `cd backend && ../.venv/bin/pytest -q`
Expected: 全绿（本 Task 是纯重构，行为不变）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/work_dir.py backend/app/api backend/app/tests/test_work_dir.py
git commit -m "refactor: extract get_work_dir(db, user) shared helper"
```

---

### Task 3: 数据隔离 — 批次/图像/锁/标注接口按用户过滤并开放给所有用户

**Files:**
- Modify: `backend/app/api/deps.py`（新增归属校验 helper）
- Modify: `backend/app/api/batches.py`
- Modify: `backend/app/api/images.py`
- Modify: `backend/app/api/locks.py`
- Modify: `backend/app/api/annotations.py`
- Modify: `backend/app/services/scanner.py`
- Modify: `backend/app/services/mask_import.py`
- Modify: `backend/app/tests/test_batches.py`, `backend/app/tests/test_locks.py`, `backend/app/tests/test_annotations.py`

**Interfaces:**
- Consumes: `get_work_dir(db, user)`（Task 2）。
- Produces: `get_owned_image(db, user, image_id) -> Image`、`get_owned_batch(db, user, batch_id) -> Batch`（在 `deps.py`）。

- [ ] **Step 1: `deps.py` 加两个归属校验 helper**

```python
from app.models.batch import Batch
from app.models.image import Image

def get_owned_batch(db, user, batch_id) -> Batch:
    batch = db.query(Batch).filter(Batch.id == batch_id, Batch.created_by == user.id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return batch

def get_owned_image(db, user, image_id) -> Image:
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if not img.batch or img.batch.created_by != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return img
```

> `img.batch` 需 `Image.batch` relationship 已加载（模型里已有 `batch: Mapped["Batch"] = relationship(...)`）。若 `batch` 未配置 `lazy` 显式默认即可直接访问。

- [ ] **Step 2: `batches.py` 全面改造**

- `list_batches`：`_user` 改名为 `current_user`，查询改为
  `db.query(Batch).filter(Batch.created_by == current_user.id).order_by(Batch.created_at.desc()).all()`。
- `create_batch`：`admin: User = Depends(require_admin)` → `current_user: User = Depends(get_current_user)`；
  唯一性检查改为 `Batch.name == body.name, Batch.created_by == current_user.id`；`created_by=current_user.id`。
- `delete_batch`：`require_admin` → `get_current_user`；用 `get_owned_batch(db, current_user, batch_id)` 取批次；`work_dir = get_work_dir(db, current_user)`。
- `trigger_scan`：`require_admin` → `get_current_user`；`work_dir = get_work_dir(db, current_user)`；`scan_batches(work_dir, db, created_by=current_user.id)`；`import_all_batches(work_dir, db, username=current_user.username, created_by=current_user.id)`。
- `upload_images`：`require_admin` → `get_current_user`；`batch = get_owned_batch(db, current_user, batch_id)`；`work_dir = get_work_dir(db, current_user)`。
- `import_masks`：`require_admin` → `get_current_user`；`batch = get_owned_batch(db, current_user, batch_id)`；`work_dir = get_work_dir(db, current_user)`。
- `list_images`：先 `get_owned_batch(db, current_user, batch_id)` 校验归属，再按 batch_id 列图像。
- `get_image`：改用 `get_owned_image(db, current_user, image_id)`。

删除文件内不再使用的 `require_admin` import（若 `create_batch` 等已全部不依赖它）。

- [ ] **Step 3: `scanner.py` 的 `scan_batches` 归属过滤**

第 23 行改为：

```python
batch = db.query(Batch).filter(Batch.name == batch_name, Batch.created_by == created_by).first()
```

- [ ] **Step 4: `mask_import.py` 的 `import_all_batches` 归属过滤**

```python
def import_all_batches(work_dir: str, db: Session, username: str = "system", created_by: int | None = None) -> dict:
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}
    q = db.query(Batch)
    if created_by is not None:
        q = q.filter(Batch.created_by == created_by)
    for batch in q.all():
        r = import_batch_masks(work_dir, batch, db, username=username)
        result["imported"] += r["imported"]
        result["skipped"] += r["skipped"]
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
    return result
```

- [ ] **Step 5: `images.py` 归属校验**

- `serve_image_file`：把 `img = db.query(Image)...` 替换为 `img = get_owned_image(db, _user, image_id)`（`_user` 改名为 `current_user`）。
- `export_mask`：`img = get_owned_image(db, current_user, image_id)`。

- [ ] **Step 6: `locks.py` 归属校验**

三个端点 `acquire_lock` / `heartbeat` / `release_lock` 中，`img = db.query(Image).filter(Image.id == image_id).first()` 都替换为 `img = get_owned_image(db, current_user, image_id)`（import 自 `app.api.deps`）。

- [ ] **Step 7: `annotations.py` 归属校验**

- `get_annotation`：`img = get_owned_image(db, current_user, image_id)`（`_user` 改名），并去掉其后单独的 batch 查询（`get_owned_image` 已校验归属，`batch` 用 `img.batch`）。
- `save_annotation`：`img = get_owned_image(db, current_user, image_id)`；`batch = img.batch`。

- [ ] **Step 8: 更新/新增测试**

`test_batches.py` 中需要改的现有用例（原期望因权限开放而变化）：

- `test_create_batch_requires_admin`：改为标注员可创建 → 期望 **201**，并断言 `created_by` 指向该标注员。
- `test_delete_batch_requires_admin`：改为标注员可删自己的批次 → 期望 **204**（需先让该标注员创建批次）。

新增隔离用例：

```python
def _annotator_token(client, username):
    resp = client.post("/api/auth/register", json={"username": username, "password": "pass1234"})
    return resp.json()["access_token"]


def test_batches_isolated_per_user(client):
    t1 = _annotator_token(client, "annA")
    t2 = _annotator_token(client, "annB")
    client.post("/api/batches", json={"name": "mine"}, headers=_auth(t1))
    # 用户2看不到用户1的批次
    r = client.get("/api/batches", headers=_auth(t2))
    assert r.json() == []
    # 用户1看得到
    r = client.get("/api/batches", headers=_auth(t1))
    assert len(r.json()) == 1


def test_same_batch_name_allowed_across_users(client):
    t1 = _annotator_token(client, "annC")
    t2 = _annotator_token(client, "annD")
    r1 = client.post("/api/batches", json={"name": "same"}, headers=_auth(t1))
    r2 = client.post("/api/batches", json={"name": "same"}, headers=_auth(t2))
    assert r1.status_code == 201 and r2.status_code == 201


def test_same_batch_name_conflict_within_user(client):
    t1 = _annotator_token(client, "annE")
    client.post("/api/batches", json={"name": "dup"}, headers=_auth(t1))
    r = client.post("/api/batches", json={"name": "dup"}, headers=_auth(t1))
    assert r.status_code == 409
```

`test_locks.py` / `test_annotations.py` 各加一条「用户无法对他人图像取锁/读写标注」的用例（用户 B 访问用户 A 的图像返回 404）。具体：用户 A 建批次并上传/扫描一张图（或直接在 DB 建 `Batch(created_by=A.id)` + `Image`），再用 B 的 token 调 `/images/{id}/lock` 与 `/images/{id}/annotation`，断言 **404**。

- [ ] **Step 9: 运行测试**

Run: `cd backend && ../.venv/bin/pytest -q`
Expected: 全绿（含更新的既有用例 + 新增隔离用例）。

- [ ] **Step 10: Commit**

```bash
git add backend/app/api backend/app/services/scanner.py backend/app/services/mask_import.py backend/app/tests
git commit -m "feat: isolate batches/images/annotations per user, open data ops to all users"
```

---

### Task 4: 统计与导出的隔离

**Files:**
- Modify: `backend/app/api/stats.py`
- Modify: `backend/app/services/stats.py`
- Modify: `backend/app/api/export.py`
- Modify: `backend/app/services/exporter.py`
- Modify: `backend/app/tests/test_stats.py`, `backend/app/tests/test_export.py`

**Interfaces:**
- Consumes: `get_work_dir(db, user)`；`Batch.created_by` 归属。
- Produces: `compute_stats(work_dir, db, batch_id=None, created_by=None)`；`collect_scope(..., created_by=None)`、`generate_export(..., created_by=None)`、`run_export(..., created_by=None)`。

- [ ] **Step 1: `services/stats.py` 的 `compute_stats` 加 `created_by` 过滤**

```python
def compute_stats(work_dir: str, db, batch_id: int | None = None, created_by: int | None = None) -> dict:
    labels = db.query(Label).filter(Label.enabled.is_(True)).order_by(Label.sort_order, Label.id).all()
    q = db.query(Image).join(Batch, Image.batch_id == Batch.id)
    if created_by is not None:
        q = q.filter(Batch.created_by == created_by)
    if batch_id is not None:
        q = q.filter(Image.batch_id == batch_id)
    images = q.all()

    bq = db.query(Batch)
    if created_by is not None:
        bq = bq.filter(Batch.created_by == created_by)
    batch_names = {b.id: b.name for b in bq.all()}
    # 其余逻辑不变（counts 循环）
    ...
    return {"total_images": len(images), "labels": [{"name": l.name, **counts[l.name]} for l in labels]}
```

- [ ] **Step 2: `api/stats.py` 传归属**

`get_stats`：`current_user = Depends(get_current_user)`（`_user` 改名），
`work_dir = get_work_dir(db, current_user)`，`compute_stats(work_dir, db, batch_id, created_by=current_user.id)`。

- [ ] **Step 3: `services/exporter.py` 归属贯穿**

- `_resolve_scope(db, scope, image_id, batch_id, created_by=None)`：把 `db.query(Image)` 改为带 join + created_by 过滤的基查询，三个 scope 都基于它。
- `collect_scope(work_dir, db, scope, image_id, batch_id, created_by=None)`：把 `created_by` 透传给 `_resolve_scope`。
- `_load_items` 的 `batch_names` 查询加 `created_by` 过滤（参数透传）。
- `_scope_name(db, scope, image_id, batch_id, images, created_by=None)`：batch 分支查 `Batch.id == batch_id, Batch.created_by == created_by`。
- `generate_export(..., created_by=None)` 与 `run_export(..., created_by=None)`：把 `created_by` 透传给 `_scope_name` / `collect_scope`。

- [ ] **Step 4: `api/export.py` 传归属**

`export`：`collect_scope(work_dir, db, body.scope, body.imageId, body.batchId, created_by=current_user.id)`，`generate_export(..., created_by=current_user.id)`。

- [ ] **Step 5: 更新测试**

- `test_stats.py`：新增/修改用例，用户 A 有图像、用户 B 无图像时，B 的 `totalImages` 为 0；指定 `batch_id` 若不属于当前用户则统计为空。
- `test_export.py`：新增「用户 B 导出用户 A 的批次 → 404 或空结果」用例（`scope="batch"` 且 batch 不属于 B 时 `collect_scope` 返回空 images → 404）。

- [ ] **Step 6: 运行测试 + Commit**

Run: `cd backend && ../.venv/bin/pytest -q`
```bash
git add backend/app/api/stats.py backend/app/services/stats.py backend/app/api/export.py backend/app/services/exporter.py backend/app/tests
git commit -m "feat: scope stats and export to current user"
```

---

### Task 5: 「我的工作目录」接口 + 用户角色收紧

**Files:**
- Modify: `backend/app/schemas/user.py`
- Modify: `backend/app/api/users.py`
- Modify: `backend/app/tests/test_users.py`

**Interfaces:**
- Produces: `GET /users/me`（返回当前用户，含 `work_dir`）、`PUT /users/me/work_dir`（body `{work_dir}`）。`UserResponse.work_dir`。

- [ ] **Step 1: `schemas/user.py`**

```python
class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class UserUpdate(BaseModel):
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=128)


class WorkDirUpdate(BaseModel):
    work_dir: str = Field(max_length=1024)


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    work_dir: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}
```
（删除 `UserCreate.role` 和 `UserUpdate.role` 字段。）

- [ ] **Step 2: `api/users.py`**

- `create_user`：删掉 `role=body.role`，改为 `role="annotator"`。
- `update_user`：删掉 `if body.role is not None: user.role = body.role` 分支。
- 新增（放在 `list_users` 之后、`/users/{user_id}` 之前）：

```python
from app.schemas.user import WorkDirUpdate

@router.get("/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/users/me/work_dir", response_model=UserResponse)
def update_my_work_dir(
    body: WorkDirUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.work_dir = body.work_dir
    db.commit()
    db.refresh(current_user)
    return current_user
```
（需 `from app.api.deps import get_current_user`，并确保 `import` 顺序让 `/users/me` 路由先于 `/users/{user_id}` 注册。）

- [ ] **Step 3: 更新 `test_users.py`**

既有用例需要改：

- `test_create_user_as_admin`：请求体去掉 `role`，断言 `data["role"] == "annotator"`。
- `test_create_duplicate_user_returns_409`：请求体去掉 `role`。
- `test_update_user_as_admin`：请求体去掉 `role`，删除「role 变 admin」断言。
- 删除依赖「可创建第二个 admin」的 `test_delete_other_admin_succeeds`、`test_non_primary_admin_cannot_delete_admin`（现在不可能创建第二个 admin；`delete_user` 里的 admin 保护逻辑可保留，但其相关测试因无法造第二个 admin 而删除或改写为「无法创建 admin」）。

新增：

```python
def test_create_user_cannot_be_admin(client):
    token = _create_admin(client)
    # role 字段即使被传入也会被忽略（schema 已不含 role，pydantic 忽略多余字段）
    resp = client.post("/api/users",
                       json={"username": "noadmin", "password": "pass1234", "role": "admin"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    assert resp.json()["role"] == "annotator"


def test_update_user_cannot_change_role(client):
    token = _create_admin(client)
    create = client.post("/api/users", json={"username": "ur", "password": "pass1234"},
                         headers={"Authorization": f"Bearer {token}"})
    uid = create.json()["id"]
    resp = client.put(f"/api/users/{uid}", json={"role": "admin"},
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "annotator"


def test_me_work_dir_roundtrip(client):
    resp = client.post("/api/auth/register", json={"username": "me1", "password": "pass1234"})
    token = resp.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/users/me", headers=h)
    assert r.json()["work_dir"] is None
    r = client.put("/api/users/me/work_dir", json={"work_dir": "/home/me1"}, headers=h)
    assert r.status_code == 200 and r.json()["work_dir"] == "/home/me1"
    assert client.get("/api/users/me", headers=h).json()["work_dir"] == "/home/me1"
```

- [ ] **Step 4: 运行测试 + Commit**

Run: `cd backend && ../.venv/bin/pytest -q`
```bash
git add backend/app/schemas/user.py backend/app/api/users.py backend/app/tests/test_users.py
git commit -m "feat: per-user work_dir endpoints + tighten user role creation"
```

---

### Task 6: 前端 — 我的工作目录 + 用户页角色 + 批次删除按钮

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/users.ts`
- Create: `frontend/src/pages/MySettingsPage.tsx`, `frontend/src/pages/MySettingsPage.module.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/common/Layout.tsx`
- Modify: `frontend/src/pages/AdminUsersPage.tsx`
- Modify: `frontend/src/components/panels/BatchSelector.tsx`
- Delete: `frontend/src/pages/AdminSettingsPage.tsx`, `frontend/src/pages/AdminSettingsPage.module.css`

**Interfaces:**
- Consumes: `GET /users/me`、`PUT /users/me/work_dir`、`POST /users`（无 role）。

- [ ] **Step 1: `types/api.ts` 的 `User` 加 `work_dir`**

```ts
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'annotator';
  is_active: boolean;
  work_dir: string | null;
  created_at: string;
}
```

- [ ] **Step 2: `api/users.ts`**

```ts
export async function fetchMe(): Promise<User> {
  return apiClient.get<User>('/users/me');
}

export async function updateMyWorkDir(workDir: string): Promise<User> {
  return apiClient.put<User>('/users/me/work_dir', { work_dir: workDir });
}

export async function createUser(data: { username: string; password: string }): Promise<User> {
  return apiClient.post<User>('/users', data);
}

export async function updateUser(id: number, data: { is_active?: boolean; password?: string }): Promise<User> {
  return apiClient.put<User>(`/users/${id}`, data);
}
```

- [ ] **Step 3: 新建 `MySettingsPage.tsx` + css**

`MySettingsPage.module.css` 可直接复制 `AdminSettingsPage.module.css` 的样式（字段/输入框/按钮/提示/成功/错误），类名不变。`MySettingsPage.tsx`：

```tsx
import { useState, useEffect } from 'react';
import { fetchMe, updateMyWorkDir } from '../api/users';
import { ApiError } from '../api/client';
import styles from './MySettingsPage.module.css';

export default function MySettingsPage() {
  const [workDir, setWorkDir] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMe().then(u => setWorkDir(u.work_dir ?? '')).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError(''); setSaved(false);
    try {
      await updateMyWorkDir(workDir);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>我的设置</h2>
      {error && <div className={styles.error}>{error}</div>}
      {saved && <div className={styles.success}>已保存</div>}
      <div className={styles.field}>
        <label className={styles.label}>我的工作目录（数据根目录）</label>
        <input className={styles.input} value={workDir}
          onChange={e => setWorkDir(e.target.value)}
          placeholder="/path/to/my/data" />
        <p className={styles.hint}>图像批次将存放在此目录下的 batches/ 子目录中（仅本人可见）</p>
      </div>
      <button className={styles.btn} onClick={handleSave}>保存设置</button>
    </div>
  );
}
```

- [ ] **Step 4: 路由与导航**

- `App.tsx`：删除 `import AdminSettingsPage`，新增 `import MySettingsPage`；把 `/admin/settings` 路由改为 `<Route path="/settings" element={<MySettingsPage />} />`。
- `Layout.tsx`：把「系统设置」链接移出 admin 块，改为对所有用户显示：在「统计」之后加 `<Link to="/settings">设置</Link>`，并从 admin 块中删除「系统设置」一行。

- [ ] **Step 5: `AdminUsersPage.tsx` 去掉角色选择**

- 删除 `newUser` 的 `role` 字段与 `<select>` 角色下拉。
- `createUser(newUser)` 调用不再传 `role`。

- [ ] **Step 6: `BatchSelector.tsx` 删除按钮对所有人可见**

删除 `{user?.role === 'admin' && currentBatchId && (...)}` 里的 `user?.role === 'admin' &&`，改为 `currentBatchId && (...)`（后端已按归属校验，用户只能删自己的）。同时若 `user` 变量不再使用，删除其 import。

- [ ] **Step 7: 删除旧设置页文件**

`git rm frontend/src/pages/AdminSettingsPage.tsx frontend/src/pages/AdminSettingsPage.module.css`

- [ ] **Step 8: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: 通过，无 TS 报错。

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "feat: per-user work dir settings UI + tighten user role UI"
```

---

### Task 7: 文档更新

**Files:**
- Modify: `docs/软件使用指南.md`

- [ ] **Step 1: 更新指南**

- §1 快速开始：改为「管理员先创建标注员账号；每个用户登录后在『设置』里配置**自己的**工作目录」。
- §3 批次管理：删除批次/扫描/上传不再标注「仅管理员」，改为「所有用户，操作自己的数据」；补充「每个用户只能看到自己的批次」。
- 新增/改写「系统设置」相关段落为「我的工作目录」。
- 权限说明：只有一个 admin，admin 只能新建标注员。

- [ ] **Step 2: Commit**

```bash
git add docs/软件使用指南.md
git commit -m "docs: update guide for per-user work dir"
```

---

## 已知限制（记录于 spec）

- 删除用户时其批次 `created_by` 置 NULL（沿用现状），成为不可见的孤儿数据，磁盘文件保留；本计划不做级联删除。
- 标签（`Label`）全局共享，不做按用户隔离。
- admin 也隔离，无「查看全部数据」的监督视角（如需再单独规划）。

## 验证（端到端）

1. `cd backend && ../.venv/bin/pytest -q` 全绿。
2. `cd frontend && npx tsc --noEmit && npx vite build` 通过。
3. 手工：admin 登录 → 用户管理新建标注员 A、B；A、B 各自在「设置」填自己的目录 → 上传/扫描批次 → 互相看不到对方批次；A 建批次 `b1`，B 也建 `b1` 不冲突；admin 建用户时无角色下拉。
