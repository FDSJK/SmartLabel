# 二值 Mask 导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在扫描/导入批次时，把 `masks/<标签名>/<原图文件名>.png|jpg` 的二值标签矢量化成多边形，自动写入 sidecar JSON 标注文件，并自动创建缺失标签。

**Architecture:** 新增后端 service `mask_import.py`，用 OpenCV 把二值 mask 转成多边形（先阈值化、再找轮廓、再简化），复用现有 `annotation_store.write_annotation` 写 JSON。扫描端点与新增的 `import-masks` 端点共用该 service。前端零改动。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy、Pillow、NumPy、OpenCV（opencv-python-headless）、pytest。

## Global Constraints

- Python 环境：项目 venv 位于仓库根目录 `.venv`，命令前缀 `../.venv/bin/`（在 `backend/` 目录下执行）。
- 新增依赖：`opencv-python-headless>=4.9.0`（加入 `backend/pyproject.toml` 的 `dependencies`）。
- 阈值化：`>128 → 255`，`≤128 → 0`（处理 JPG 有损压缩的边缘插值）。
- 轮廓：`cv2.RETR_EXTERNAL`（只取外轮廓，孔洞被填实）、`cv2.CHAIN_APPROX_SIMPLE`；`epsilon = max(1.0, 0.005 * 周长)`；面积 `< 4px` 的轮廓丢弃。
- mask 组织：`batches/<batch>/masks/<标签名>/<原图文件名>.png|jpg|jpeg`（文件夹名即标签名，文件名与原图一致）。
- 标签：文件夹名不存在于 `labels` 表时自动创建（复用 `app.api.labels._next_color` 取色）。
- 空标注判定：无 sidecar JSON，或 JSON 存在但 `shapes` 为空 → 才导入；非空 → 跳过，不覆盖人工标注。
- 尺寸不符：mask 宽高与原图不一致 → 跳过该 mask，并把数据文件名写入 `errors`，继续其它图像。
- 导入后：`labelStatus[标签] = present`；JSON `version` 在原基础上 +1；`image.annotation_rev` 同步；`image.status` 保持 `pending`。
- 前端：无改动。
- 测试命令：`cd backend && ../.venv/bin/pytest <path>`。

---

### Task 1: 新增 OpenCV 依赖

**Files:**
- Modify: `backend/pyproject.toml`（`dependencies` 列表）

**Interfaces:**
- Produces: 使 `import cv2` 在 venv 中可用（Task 2 依赖）。

- [ ] **Step 1: 在 pyproject.toml 加依赖**

在 `dependencies` 列表中，`"numpy>=1.26.0",` 之后新增一行：

```toml
    "numpy>=1.26.0",
    "opencv-python-headless>=4.9.0",
    "onnxruntime>=1.18.0",
```

- [ ] **Step 2: 安装依赖**

Run: `cd backend && ../.venv/bin/pip install "opencv-python-headless>=4.9.0"`

Expected: 安装成功，无报错。

- [ ] **Step 3: 验证 import cv2**

Run: `../.venv/bin/python -c "import cv2; print(cv2.__version__)"`

Expected: 打印版本号，无 `ModuleNotFoundError`。

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml
git commit -m "chore: add opencv-python-headless dependency"
```

---

### Task 2: `vectorize_mask` + 单元测试

**Files:**
- Create: `backend/app/services/mask_import.py`（先只写 `vectorize_mask` 与常量）
- Test: `backend/app/tests/test_vectorize_mask.py`

**Interfaces:**
- Produces: `vectorize_mask(mask_path: str, threshold: int = 128) -> list[list[list[float]]]` —— 输入 mask 图片路径，返回多边形列表（每个多边形 `[[x,y], ...]`）。

- [ ] **Step 1: 写失败测试**

创建 `backend/app/tests/test_vectorize_mask.py`：

```python
import numpy as np
from PIL import Image as PILImage
from app.services.mask_import import vectorize_mask


def _write_mask(tmp_path, name, arr):
    p = tmp_path / name
    PILImage.fromarray(arr).save(str(p))
    return str(p)


def test_vectorize_rectangle(tmp_path):
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[20:80, 20:80] = 255
    path = _write_mask(tmp_path, "rect.png", arr)
    polys = vectorize_mask(path)
    assert len(polys) == 1
    xs = [p[0] for p in polys[0]]
    ys = [p[1] for p in polys[0]]
    assert 18 <= min(xs) <= 22 and 78 <= max(xs) <= 82
    assert 18 <= min(ys) <= 22 and 78 <= max(ys) <= 82


def test_vectorize_thresholds_gradient(tmp_path):
    # 左半 100（应判为背景），右半 200（应判为前景）
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[:, :50] = 100
    arr[:, 50:] = 200
    path = _write_mask(tmp_path, "grad.png", arr)
    polys = vectorize_mask(path)
    assert len(polys) == 1
    xs = [p[0] for p in polys[0]]
    assert min(xs) >= 49 and max(xs) <= 100  # 只有右半是前景


def test_vectorize_jpg_handles_interpolation(tmp_path):
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[30:70, 30:70] = 255
    p = tmp_path / "block.jpg"
    PILImage.fromarray(arr).save(str(p), quality=85)  # JPG 有损 → 边缘插值
    polys = vectorize_mask(str(p))
    assert len(polys) >= 1
    xs = [pt[0] for pt in polys[0]]
    assert 25 <= min(xs) <= 35 and 65 <= max(xs) <= 75
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_vectorize_mask.py -v`

Expected: FAIL，报 `ModuleNotFoundError: No module named 'app.services.mask_import'`。

- [ ] **Step 3: 实现 `mask_import.py`**

创建 `backend/app/services/mask_import.py`：

```python
import cv2
import numpy as np
from PIL import Image as PILImage

MASK_EXTENSIONS = (".png", ".jpg", ".jpeg")
MIN_CONTOUR_AREA = 4.0
DEFAULT_THRESHOLD = 128


def vectorize_mask(mask_path: str, threshold: int = DEFAULT_THRESHOLD) -> list[list[list[float]]]:
    """把一张二值 mask 图转成多边形列表。每个多边形为 [[x, y], ...]。

    先转灰度、以 threshold 为界二值化（处理 JPG 有损压缩的边缘插值），
    再用 OpenCV 提取外轮廓并做多边形简化。
    """
    img = PILImage.open(mask_path).convert("L")
    arr = np.array(img, dtype=np.uint8)
    binary = (arr > threshold).astype(np.uint8) * 255

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons: list[list[list[float]]] = []
    for c in contours:
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            continue
        peri = cv2.arcLength(c, True)
        epsilon = max(1.0, 0.005 * peri)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = [[float(p[0][0]), float(p[0][1])] for p in approx]
        if len(pts) >= 3:
            polygons.append(pts)
    return polygons
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_vectorize_mask.py -v`

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/mask_import.py backend/app/tests/test_vectorize_mask.py
git commit -m "feat: vectorize binary mask to polygons via OpenCV"
```

---

### Task 3: `import_image_masks` / `import_batch_masks` + 服务测试

**Files:**
- Modify: `backend/app/services/mask_import.py`（追加导入逻辑）
- Test: `backend/app/tests/test_mask_import.py`

**Interfaces:**
- Consumes: `vectorize_mask`（Task 2）；`app.services.annotation_store.read_annotation` / `write_annotation`；`app.services.image_processor.get_image_info`；`app.models.{Batch,Image,Label}`。
- Produces:
  - `import_image_masks(work_dir, batch, image, db) -> dict`，返回 `{"imported": bool, "shapes": [...], "label_status": {...}, "errors": [...], "created_labels": [...]}`。
  - `import_batch_masks(work_dir, batch, db, username="system") -> dict`，返回 `{"imported": int, "skipped": int, "errors": [...], "created_labels": [...]}`。

- [ ] **Step 1: 写失败测试**

创建 `backend/app/tests/test_mask_import.py`：

```python
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
    _make_mask(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))

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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import.py -v`

Expected: FAIL，报 `ImportError: cannot import name 'import_batch_masks'`。

- [ ] **Step 3: 在 `mask_import.py` 追加导入逻辑**

在现有 `mask_import.py` 末尾追加（顶部 import 也一并更新）：

```python
import os
import uuid
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.image import Image
from app.models.label import Label
from app.services.annotation_store import read_annotation, write_annotation
from app.services.image_processor import get_image_info


def _get_or_create_label(db: Session, name: str) -> tuple[Label, bool]:
    label = db.query(Label).filter(Label.name == name).first()
    if label:
        return label, False
    from app.api.labels import _next_color
    max_order = db.query(Label).order_by(Label.sort_order.desc()).first()
    label = Label(
        name=name,
        color=_next_color(db),
        sort_order=(max_order.sort_order + 1) if max_order else 0,
    )
    db.add(label)
    db.flush()
    return label, True


def import_image_masks(work_dir: str, batch: Batch, image: Image, db: Session) -> dict:
    """为单张空标注图像导入 mask。返回 {imported, shapes, label_status, errors, created_labels}。"""
    result = {"imported": False, "shapes": [], "label_status": {},
              "errors": [], "created_labels": []}

    masks_dir = os.path.join(work_dir, "batches", batch.name, "masks")
    if not os.path.isdir(masks_dir):
        return result

    stem = os.path.splitext(image.file_name)[0]

    for label_name in sorted(os.listdir(masks_dir)):
        subdir = os.path.join(masks_dir, label_name)
        if not os.path.isdir(subdir):
            continue

        mask_path = None
        for ext in MASK_EXTENSIONS:
            candidate = os.path.join(subdir, stem + ext)
            if os.path.isfile(candidate):
                mask_path = candidate
                break
        if mask_path is None:
            continue

        rel = os.path.relpath(mask_path, start=work_dir)
        try:
            info = get_image_info(mask_path)
        except Exception as e:
            result["errors"].append({"file": rel, "error": str(e)})
            continue
        if info["width"] != image.width or info["height"] != image.height:
            result["errors"].append({"file": rel, "error": "size mismatch"})
            continue

        try:
            polygons = vectorize_mask(mask_path)
        except Exception as e:
            result["errors"].append({"file": rel, "error": str(e)})
            continue
        if not polygons:
            continue

        _, created = _get_or_create_label(db, label_name)
        if created:
            result["created_labels"].append(label_name)

        for pts in polygons:
            result["shapes"].append({
                "id": str(uuid.uuid4()),
                "label": label_name,
                "shapeType": "polygon",
                "points": pts,
            })
        result["label_status"][label_name] = "present"

    result["imported"] = len(result["shapes"]) > 0
    return result


def import_batch_masks(work_dir: str, batch: Batch, db: Session, username: str = "system") -> dict:
    """为批次中所有空标注图像导入 mask，写 sidecar JSON 并同步 annotation_rev。"""
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}

    images = db.query(Image).filter(Image.batch_id == batch.id).all()
    for image in images:
        data = read_annotation(work_dir, batch.name, image.file_name)
        if data and data.get("shapes"):
            result["skipped"] += 1
            continue

        current_version = data.get("version", 0) if data else 0
        r = import_image_masks(work_dir, batch, image, db)
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
        if not r["imported"]:
            continue

        existing_status = data.get("labelStatus", {}) if data else {}
        saved = write_annotation(
            work_dir=work_dir,
            batch_name=batch.name,
            file_name=image.file_name,
            shapes=r["shapes"],
            label_status={**existing_status, **r["label_status"]},
            image_width=image.width,
            image_height=image.height,
            username=username,
            current_version=current_version,
        )
        image.annotation_rev = saved["version"]
        result["imported"] += 1

    db.commit()
    return result


def import_all_batches(work_dir: str, db: Session, username: str = "system") -> dict:
    """对所有批次执行 mask 导入，聚合结果。"""
    result = {"imported": 0, "skipped": 0, "errors": [], "created_labels": []}
    for batch in db.query(Batch).all():
        r = import_batch_masks(work_dir, batch, db, username=username)
        result["imported"] += r["imported"]
        result["skipped"] += r["skipped"]
        result["errors"].extend(r["errors"])
        result["created_labels"].extend(r["created_labels"])
    return result
```

顶部 import 从：

```python
import cv2
import numpy as np
from PIL import Image as PILImage
```

改为：

```python
import os
import uuid
import cv2
import numpy as np
from PIL import Image as PILImage
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.image import Image
from app.models.label import Label
from app.services.annotation_store import read_annotation, write_annotation
from app.services.image_processor import get_image_info
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import.py -v`

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/mask_import.py backend/app/tests/test_mask_import.py
git commit -m "feat: import binary masks into annotation JSON per batch"
```

---

### Task 4: 接入扫描端点 + 新增 import-masks 端点

**Files:**
- Modify: `backend/app/api/batches.py`
- Test: `backend/app/tests/test_mask_import_endpoints.py`

**Interfaces:**
- Consumes: `scan_batches`（现有）、`import_batch_masks` / `import_all_batches`（Task 3）。
- Produces: `POST /api/batches/scan` 响应新增 `imported`、`created_labels` 字段，`errors` 追加 mask 导入错误；新增 `POST /api/batches/{batch_id}/import-masks` 返回 `{imported, skipped, errors, created_labels}`。

- [ ] **Step 1: 写失败测试**

创建 `backend/app/tests/test_mask_import_endpoints.py`：

```python
import json
import os
import numpy as np
from PIL import Image as PILImage
from fastapi.testclient import TestClient


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


def _make_image(tmp_work_dir, batch, fname="a.png", size=32):
    d = os.path.join(tmp_work_dir, "batches", batch, "images")
    os.makedirs(d)
    PILImage.fromarray(np.zeros((size, size, 3), dtype=np.uint8)).save(os.path.join(d, fname))


def _make_mask(tmp_work_dir, batch, label="cat", fname="a.png", size=32):
    d = os.path.join(tmp_work_dir, "batches", batch, "masks", label)
    os.makedirs(d)
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[size // 4: 3 * size // 4, size // 4: 3 * size // 4] = 255
    PILImage.fromarray(mask).save(os.path.join(d, fname))


def test_scan_imports_masks(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, "b1")
    _make_mask(tmp_work_dir, "b1")
    resp = client.post("/api/batches/scan", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 1
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json"))


def test_import_masks_endpoint(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir, "b2")
    client.post("/api/batches/scan", headers=_auth(token))
    # 此时还没有 mask → 无 JSON
    assert not os.path.isfile(os.path.join(tmp_work_dir, "batches", "b2", "annotations", "a.json"))

    _make_mask(tmp_work_dir, "b2")
    batches = client.get("/api/batches", headers=_auth(token)).json()
    b2 = next(b for b in batches if b["name"] == "b2")

    resp = client.post(f"/api/batches/{b2['id']}/import-masks", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["imported"] == 1
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b2", "annotations", "a.json"))

    # 幂等：再跑一次 → 全部 skipped
    resp2 = client.post(f"/api/batches/{b2['id']}/import-masks", headers=_auth(token))
    assert resp2.json()["imported"] == 0
    assert resp2.json()["skipped"] == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import_endpoints.py -v`

Expected: FAIL（`scan` 响应里没有 `imported`，`import-masks` 返回 404）。

- [ ] **Step 3: 修改 `batches.py`**

在 `backend/app/api/batches.py` 顶部 import 区（`from app.services.scanner import scan_batches` 之后）加：

```python
from app.services.mask_import import import_batch_masks, import_all_batches
```

修改 `trigger_scan` 函数体为：

```python
@router.post("/batches/scan")
def trigger_scan(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    work_dir = _get_work_dir(db)
    result = scan_batches(work_dir, db, created_by=admin.id)
    imp = import_all_batches(work_dir, db, username=admin.username)
    result["imported"] = imp["imported"]
    result["created_labels"] = list(dict.fromkeys(imp["created_labels"]))
    result["errors"].extend(imp["errors"])
    return result
```

在文件末尾（`list_images` 之后）新增端点：

```python
@router.post("/batches/{batch_id}/import-masks")
def import_masks(
    batch_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = _get_work_dir(db)
    r = import_batch_masks(work_dir, batch, db, username=admin.username)
    r["created_labels"] = list(dict.fromkeys(r["created_labels"]))
    return r
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import_endpoints.py -v`

Expected: 2 passed。

- [ ] **Step 5: 全量回归**

Run: `cd backend && ../.venv/bin/pytest -q`

Expected: 全部通过，无既有用例被破坏。

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/batches.py backend/app/tests/test_mask_import_endpoints.py
git commit -m "feat: auto-import masks on scan + import-masks endpoint"
```

---

## Self-Review Notes

- **Spec 覆盖**：§3.1 矢量化 → Task 2；§3.2 空标注判定 + §3.3 导入 + 标签自动创建 + labelStatus → Task 3；§3.4 扫描触发 + 独立端点 + 幂等 → Task 4；§5 错误处理（尺寸不符/损坏/无 mask）→ Task 3 实现与测试；§2 命名约定 → `import_image_masks` 的 `masks/<label>/<stem>.<ext>` 查找逻辑。
- **占位符**：无 TBD/TODO，所有步骤含实际代码。
- **类型一致性**：`vectorize_mask` / `import_image_masks` / `import_batch_masks` / `import_all_batches` 命名在各任务间一致；`MASK_EXTENSIONS` 在 Task 2 定义、Task 3 引用。
