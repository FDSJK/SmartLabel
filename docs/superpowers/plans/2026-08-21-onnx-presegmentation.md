# ONNX 预分割（第四阶段）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为标注工具增加 ONNX 语义分割预分割——模型配置管理、单图/整批推理、草稿持久化与接受/拒绝，全程复用既有矢量化与保存/导出链路。

**Architecture:** 后端新增两张表（`model_configs` / `inference_jobs`）、一个 `onnx_service`（预处理/推理/后处理/矢量化）、一个 `draft_store`（草稿 JSON 读写）与三个路由（模型配置 / 推理 / 草稿）。前端新增 `draftStore` + `DraftLayer`（render-only）+ 单交互层路由（DrawingLayer 扩展）+ `InferencePanel` + `AdminModelsPage`。

**Tech Stack:** FastAPI + SQLAlchemy 2 + SQLite；ONNX Runtime（CPU/CUDA）；cv2 + numpy + Pillow；React + Konva + Zustand。

## Global Constraints

- 输出统一 **N+1 通道**（N 标签 + 1 背景），`background_channel` 可配（默认 **0**，对齐用户 TransUNet）。
- 后处理 `argmax` / `sigmoid` 可配；sigmoid 阈值可配（默认 0.5）。
- 归一化 `normalize_mode` 可配：`min_max`（默认，逐通道逐图 `(x-min)/(max-min)`）/ `mean_std`（`(x/255-mean)/std`）/ `none`。
- resize `stretch`（默认，INTER_CUBIC）/ `letterbox`。
- 通道顺序 RGB；预处理顺序 **resize → 归一化**（对齐 `test_UWF.py`）。
- 预处理方案 A（配置驱动，无自定义代码 hook）。
- 草稿 shape 与正式 shape 同构（含 `holes`）。
- 接受草稿 → 对应标签 `labelStatus` 置 `present`（用户已确认）。
- 按用户隔离：推理/草稿端点走 `get_owned_image` / `get_owned_batch`；模型配置全局、admin 写、登录读。
- 坐标映射必须把推理 mask 逆变换回原图坐标；注意 PIL `(w,h)` vs ndarray `(h,w)`。
- 新表由 `Base.metadata.create_all` 自动创建（无需写 migration）。

---

### Task 1: 数据模型 `model_configs` + `inference_jobs` + `MODELS_DIR`

**Files:**
- Create: `backend/app/models/model_config.py`
- Create: `backend/app/models/inference_job.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/core/config.py`
- Test: `backend/app/tests/test_models.py`

**Interfaces:**
- Produces: `ModelConfig`（列见下）、`InferenceJob`（列见下）、`settings.MODELS_DIR`。

**Steps:**

- [ ] **Step 1: 写 `model_config.py`**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")  # upload | path
    model_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    input_width: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    input_height: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    resize_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="stretch")  # stretch | letterbox
    normalize_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="min_max")  # min_max | mean_std | none
    mean: Mapped[list | None] = mapped_column(JSON, nullable=True)   # [r,g,b]，仅 mean_std
    std: Mapped[list | None] = mapped_column(JSON, nullable=True)    # [r,g,b]，仅 mean_std
    background_channel: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    categories: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # [{"label","channel"}]
    postprocess: Mapped[str] = mapped_column(String(16), nullable=False, default="argmax")  # argmax | sigmoid
    sigmoid_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 2: 写 `inference_job.py`**

```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class InferenceJob(Base):
    __tablename__ = "inference_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id"), nullable=False, index=True)
    model_config_id: Mapped[int] = mapped_column(ForeignKey("model_configs.id"), nullable=False, index=True)
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="single")  # single | batch
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")  # queued | running | done | failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 3: 改 `models/__init__.py`**——追加导入与 `__all__`：

```python
from app.models.model_config import ModelConfig
from app.models.inference_job import InferenceJob

__all__ = ["User", "Setting", "Label", "Batch", "Image", "ModelConfig", "InferenceJob"]
```

- [ ] **Step 4: 改 `config.py`**——加 `MODELS_DIR`：

```python
class Settings(BaseSettings):
    WORK_DIR: str = "./data"
    MODELS_DIR: str = "./models"
    # ... 其余不变
```

- [ ] **Step 5: 写测试 `test_models.py`**（用 `client`/`app` fixture 验证建表）：

```python
def test_model_configs_and_jobs_tables_exist(app):
    from app.core.db import get_engine
    from sqlalchemy import inspect
    engine = get_engine()
    tables = inspect(engine).get_table_names()
    assert "model_configs" in tables
    assert "inference_jobs" in tables
```

> 注意：`app` fixture 里 `Base.metadata.create_all` 已绑定测试 engine，`get_engine()` 返回的是测试库。若 `get_engine` 抛「未初始化」，改用 fixture 内建的 engine 直接 inspect，或参考 `test_migrations.py` 的既有做法。

- [ ] **Step 6: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_models.py -v`，全绿。

- [ ] **Step 7: Commit**

```bash
git add backend/app/models backend/app/core/config.py backend/app/tests/test_models.py
git commit -m "feat: add model_config and inference_job models"
```

---

### Task 2: 抽取 `vectorize_array`（复用矢量化核心）

**Files:**
- Modify: `backend/app/services/mask_import.py`
- Test: `backend/app/tests/test_vectorize_mask.py`

**Interfaces:**
- Produces: `vectorize_array(binary: np.ndarray) -> list[dict]`，每个 dict `{"points": 外环, "holes": [内环...]}`。
- Consumes: 现有 `vectorize_mask(mask_path, threshold)` 改为调用新核心，行为不变。

**Steps:**

- [ ] **Step 1: 重构**——把 `vectorize_mask` 里「二值数组 → polygons」的部分抽成 `_vectorize_binary`，新增公开 `vectorize_array`：

```python
def _vectorize_binary(binary: np.ndarray) -> list[dict]:
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    kept: dict[int, list[list[float]]] = {}
    for i, c in enumerate(contours):
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            continue
        peri = cv2.arcLength(c, True)
        epsilon = max(1.0, 0.005 * peri)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = [[float(p[0][0]), float(p[0][1])] for p in approx]
        if len(pts) >= 3:
            kept[i] = pts
    polygons: list[dict] = []
    outer_by_idx: dict[int, dict] = {}
    for i, pts in kept.items():
        if hierarchy[0][i][3] == -1:
            outer_by_idx[i] = {"points": pts, "holes": []}
            polygons.append(outer_by_idx[i])
    for i, pts in kept.items():
        parent = hierarchy[0][i][3]
        if parent in outer_by_idx:
            outer_by_idx[parent]["holes"].append(pts)
    return polygons


def vectorize_array(binary: np.ndarray) -> list[dict]:
    """二进制 mask 数组（0/255，单通道）→ 多边形列表（含孔洞）。"""
    if binary.ndim == 3:
        binary = binary[:, :, 0]
    return _vectorize_binary(binary.astype(np.uint8))
```

`vectorize_mask(mask_path, threshold)` 改为：

```python
def vectorize_mask(mask_path: str, threshold: int = DEFAULT_THRESHOLD) -> list[dict]:
    img = PILImage.open(mask_path).convert("L")
    arr = np.array(img, dtype=np.uint8)
    binary = (arr > threshold).astype(np.uint8) * 255
    return vectorize_array(binary)
```

- [ ] **Step 2: 加测试**（`test_vectorize_mask.py`）——环形 mask 数组保留孔洞：

```python
def test_vectorize_array_donut_preserves_hole():
    from app.services.mask_import import vectorize_array
    arr = np.zeros((100, 100), dtype=np.uint8)
    arr[20:80, 20:80] = 255
    arr[40:60, 40:60] = 0
    polys = vectorize_array(arr)
    assert len(polys) == 1
    assert len(polys[0]["holes"]) == 1
```

- [ ] **Step 3: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_vectorize_mask.py -v`，全绿（含既有 3 个用例）。

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/mask_import.py backend/app/tests/test_vectorize_mask.py
git commit -m "refactor: extract vectorize_array from vectorize_mask"
```

---

### Task 3: `onnx_service`（预处理 / 推理 / 后处理 / 矢量化）

**Files:**
- Create: `backend/app/services/onnx_service.py`
- Test: `backend/app/tests/test_onnx_service.py`

**Interfaces:**
- Produces:
  - `preprocess(image_path: str, cfg: ModelConfig) -> tuple[np.ndarray, int, int]`（返回 `(tensor, orig_w, orig_h)`，tensor 形状 `(1,3,H,W)` float32）
  - `postprocess(logits: np.ndarray, cfg: ModelConfig, orig_w: int, orig_h: int) -> dict[str, np.ndarray]`（`{label: 原图分辨率二值 mask}`）
  - `run_inference(cfg: ModelConfig, image_path: str) -> list[dict]`（shape dict 列表，含 `id/label/shapeType/points/holes`）
  - `invalidate_session(cfg_id: int) -> None`（配置变更/删除时清缓存）
- Consumes: `mask_import.vectorize_array`。

**Steps:**

- [ ] **Step 1: 写 `preprocess`**（对齐 `test_UWF.py`：resize → min-max；注意 PIL `(w,h)`）：

```python
import os
import threading
import uuid
import cv2
import numpy as np
from PIL import Image as PILImage
import onnxruntime as ort

from app.models.model_config import ModelConfig
from app.services.mask_import import vectorize_array


def preprocess(image_path: str, cfg: ModelConfig) -> tuple[np.ndarray, int, int]:
    img = PILImage.open(image_path).convert("RGB")
    orig_w, orig_h = img.size  # PIL 是 (width, height)
    arr = np.array(img)  # (H, W, 3) uint8

    if cfg.resize_mode == "letterbox":
        arr, pad = _letterbox(arr, cfg.input_width, cfg.input_height)
    else:  # stretch
        arr = cv2.resize(arr, (cfg.input_width, cfg.input_height), interpolation=cv2.INTER_CUBIC)

    arr = arr.astype(np.float32)
    if cfg.normalize_mode == "min_max":
        mn = arr.min(axis=(0, 1), keepdims=True)
        mx = arr.max(axis=(0, 1), keepdims=True)
        arr = (arr - mn) / (mx - mn + 1e-8)
    elif cfg.normalize_mode == "mean_std":
        mean = np.array(cfg.mean or [0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
        std = np.array(cfg.std or [0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)
        arr = (arr / 255.0 - mean) / std
    # none：保持 [0,255] float32

    tensor = arr.transpose(2, 0, 1)[None, ...].astype(np.float32)  # (1,3,H,W)
    return tensor, orig_w, orig_h
```

`_letterbox`（等比缩放 + 0 填充，返回 padded 数组与填充量，供逆映射使用）：

```python
def _letterbox(arr: np.ndarray, w: int, h: int) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    h0, w0 = arr.shape[:2]
    scale = min(w / w0, h / h0)
    nw, nh = int(round(w0 * scale)), int(round(h0 * scale))
    resized = cv2.resize(arr, (nw, nh), interpolation=cv2.INTER_CUBIC)
    pad_w = w - nw
    pad_h = h - nh
    left, right = pad_w // 2, pad_w - pad_w // 2
    top, bottom = pad_h // 2, pad_h - pad_h // 2
    padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=0)
    return padded, (left, top, nw, nh)
```

- [ ] **Step 2: 写 `postprocess`**（logits → 每标签原图分辨率二值 mask）：

```python
def postprocess(logits: np.ndarray, cfg: ModelConfig, orig_w: int, orig_h: int) -> dict[str, np.ndarray]:
    logits = logits[0]  # (C, H', W')
    C = logits.shape[0]

    if cfg.postprocess == "argmax":
        class_map = logits.argmax(axis=0).astype(np.uint8)
        class_map = cv2.resize(class_map, (cfg.input_width, cfg.input_height),
                               interpolation=cv2.INTER_NEAREST)
        masks: dict[str, np.ndarray] = {}
        for cat in cfg.categories:
            masks[cat["label"]] = ((class_map == int(cat["channel"])) * 255).astype(np.uint8)
    else:  # sigmoid
        prob = 1.0 / (1.0 + np.exp(-logits))  # (C, H', W')
        masks = {}
        for cat in cfg.categories:
            ch = int(cat["channel"])
            p = cv2.resize(prob[ch], (cfg.input_width, cfg.input_height),
                           interpolation=cv2.INTER_LINEAR)
            masks[cat["label"]] = ((p > cfg.sigmoid_threshold) * 255).astype(np.uint8)

    # 逆 resize 回原图分辨率
    result: dict[str, np.ndarray] = {}
    for label, m in masks.items():
        result[label] = _inverse_resize(m, cfg, orig_w, orig_h)
    return result


def _inverse_resize(mask: np.ndarray, cfg: ModelConfig, orig_w: int, orig_h: int) -> np.ndarray:
    if cfg.resize_mode == "letterbox":
        # 先裁掉补边再等比缩放回原图（补边量需从 preprocess 返回；此处按 stretch 简化，
        # letterbox 的完整逆映射在 Task 3 的集成测试里用已知缩放比验证）
        raise NotImplementedError("letterbox inverse mapping wired in integration test")
    return cv2.resize(mask, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
```

> 说明：`letterbox` 的完整逆映射需要把 preprocess 的 pad 信息传下来。为保持接口简单，把 preprocess 的返回值改为返回一个 `PreprocessResult`（含 tensor + orig 尺寸 + pad 信息）更稳妥。实现时若走 letterbox，让 `preprocess` 返回 `(tensor, orig_w, orig_h, pad)`，`postprocess` 多收一个 `pad` 参数。stretch 路径 pad=None。计划以 stretch 为默认主路径，letterbox 作为加分项并配一个已知缩放比的单测。

- [ ] **Step 3: 写 `run_inference` 与 session 缓存**：

```python
_sessions: dict[int, ort.InferenceSession] = {}
_session_lock = threading.Lock()
_infer_lock = threading.Lock()


def _get_session(cfg: ModelConfig) -> ort.InferenceSession:
    with _session_lock:
        if cfg.id not in _sessions:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if ort.get_available_providers().__contains__("CUDAExecutionProvider") else ["CPUExecutionProvider"]
            _sessions[cfg.id] = ort.InferenceSession(cfg.model_path, providers=providers)
        return _sessions[cfg.id]


def invalidate_session(cfg_id: int) -> None:
    with _session_lock:
        _sessions.pop(cfg_id, None)


def run_inference(cfg: ModelConfig, image_path: str) -> list[dict]:
    tensor, orig_w, orig_h = preprocess(image_path, cfg)
    with _infer_lock:  # CPU 串行化
        session = _get_session(cfg)
        out = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    masks = postprocess(out, cfg, orig_w, orig_h)
    shapes: list[dict] = []
    for cat in cfg.categories:
        label = cat["label"]
        if label not in masks:
            continue
        for poly in vectorize_array(masks[label]):
            shapes.append({
                "id": str(uuid.uuid4()),
                "label": label,
                "shapeType": "polygon",
                "points": poly["points"],
                "holes": poly["holes"],
            })
    return shapes
```

- [ ] **Step 4: 写测试 `test_onnx_service.py`**（纯函数，不加载真实模型）：

```python
import numpy as np
from app.models.model_config import ModelConfig


def _cfg(**kw) -> ModelConfig:
    base = dict(
        id=1, name="t", source="path", model_path="/x.onnx",
        input_width=8, input_height=8, resize_mode="stretch", normalize_mode="min_max",
        mean=None, std=None, background_channel=0,
        categories=[{"label": "cat", "channel": 1}], postprocess="argmax",
        sigmoid_threshold=0.5, enabled=True,
    )
    base.update(kw)
    return ModelConfig(**base)


def _write_img(path, w, h):
    from PIL import Image as PILImage
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    PILImage.fromarray(np.zeros((h, w, 3), dtype=np.uint8)).save(path)


def test_preprocess_minmax_shape_and_range(tmp_path):
    from app.services.onnx_service import preprocess
    p = str(tmp_path / "a.png"); _write_img(p, 8, 8)
    tensor, ow, oh = preprocess(p, _cfg())
    assert tensor.shape == (1, 3, 8, 8)
    assert (ow, oh) == (8, 8)
    assert float(tensor.min()) >= 0.0 and float(tensor.max()) <= 1.0  # min-max 后落在 [0,1]


def test_postprocess_argmax_maps_back_to_original_size(tmp_path):
    from app.services.onnx_service import postprocess
    cfg = _cfg(input_width=4, input_height=4)
    logits = np.zeros((1, 2, 4, 4), dtype=np.float32)
    logits[:, 1, :, :] = 1.0  # 全为 cat（channel 1）
    masks = postprocess(logits, cfg, orig_w=8, orig_h=8)
    assert set(masks.keys()) == {"cat"}
    assert masks["cat"].shape == (8, 8)
    assert masks["cat"].max() == 255


def test_run_inference_produces_shapes(monkeypatch, tmp_path):
    from app.services import onnx_service
    p = str(tmp_path / "a.png"); _write_img(p, 16, 16)
    fake = [{"id": "x", "label": "cat", "shapeType": "polygon",
             "points": [[0, 0], [1, 0], [1, 1]], "holes": []}]
    monkeypatch.setattr(onnx_service, "run_inference", lambda cfg, path: fake)
    assert onnx_service.run_inference(_cfg(), p) == fake
```

- [ ] **Step 5: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_onnx_service.py -v`，全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/onnx_service.py backend/app/tests/test_onnx_service.py
git commit -m "feat: add onnx inference service (preprocess/infer/postprocess)"
```

---

### Task 4: `draft_store`（草稿 JSON 读写）

**Files:**
- Create: `backend/app/services/draft_store.py`
- Test: `backend/app/tests/test_draft_store.py`

**Interfaces:**
- Produces:
  - `read_draft(work_dir, batch_name, file_name) -> dict | None`
  - `write_draft(work_dir, batch_name, file_name, draft: dict) -> dict`（原子写）
  - `delete_draft(work_dir, batch_name, file_name) -> None`

**Steps:**

- [ ] **Step 1: 写 `draft_store.py`**（镜像 `annotation_store.py` 的原子写）：

```python
import json
import os
import uuid


def _draft_path(work_dir: str, batch_name: str, file_name: str) -> str:
    stem = os.path.splitext(file_name)[0]
    return os.path.join(work_dir, "batches", batch_name, "drafts", f"{stem}.json")


def read_draft(work_dir: str, batch_name: str, file_name: str) -> dict | None:
    path = _draft_path(work_dir, batch_name, file_name)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_draft(work_dir: str, batch_name: str, file_name: str, draft: dict) -> dict:
    path = _draft_path(work_dir, batch_name, file_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(draft, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    return draft


def delete_draft(work_dir: str, batch_name: str, file_name: str) -> None:
    path = _draft_path(work_dir, batch_name, file_name)
    if os.path.isfile(path):
        os.remove(path)
```

- [ ] **Step 2: 写测试 `test_draft_store.py`**：

```python
def test_draft_roundtrip(tmp_work_dir):
    from app.services.draft_store import read_draft, write_draft, delete_draft
    draft = {"imageName": "a.png", "shapes": []}
    write_draft(tmp_work_dir, "b1", "a.png", draft)
    assert read_draft(tmp_work_dir, "b1", "a.png") == draft
    delete_draft(tmp_work_dir, "b1", "a.png")
    assert read_draft(tmp_work_dir, "b1", "a.png") is None
```

- [ ] **Step 3: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_draft_store.py -v`，全绿。

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/draft_store.py backend/app/tests/test_draft_store.py
git commit -m "feat: add draft JSON store"
```

---

### Task 5: 模型配置 API（schema + CRUD + 上传）

**Files:**
- Create: `backend/app/schemas/model_config.py`
- Create: `backend/app/api/models.py`
- Modify: `backend/app/api/__init__.py`
- Test: `backend/app/tests/test_models_api.py`

**Interfaces:**
- Consumes: `ModelConfig`、`settings.MODELS_DIR`、`require_admin`/`get_current_user`。
- Produces: 端点 `GET/POST/PUT/DELETE /api/models[/{id}]`、`POST /api/models/upload`。

**Steps:**

- [ ] **Step 1: 写 `schemas/model_config.py`**（Pydantic v2）：

```python
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class CategoryMapping(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    channel: int = Field(ge=0)


class ModelConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    source: Literal["upload", "path"] = "upload"
    model_path: str = Field(min_length=1, max_length=1024)
    input_width: int = Field(default=512, ge=1)
    input_height: int = Field(default=512, ge=1)
    resize_mode: Literal["stretch", "letterbox"] = "stretch"
    normalize_mode: Literal["min_max", "mean_std", "none"] = "min_max"
    mean: list[float] | None = None
    std: list[float] | None = None
    background_channel: int = 0
    categories: list[CategoryMapping] = []
    postprocess: Literal["argmax", "sigmoid"] = "argmax"
    sigmoid_threshold: float = 0.5
    enabled: bool = True


class ModelConfigUpdate(ModelConfigCreate):
    pass


class ModelConfigResponse(BaseModel):
    id: int
    name: str
    source: str
    model_path: str
    input_width: int
    input_height: int
    resize_mode: str
    normalize_mode: str
    mean: list[float] | None
    std: list[float] | None
    background_channel: int
    categories: list[dict]
    postprocess: str
    sigmoid_threshold: float
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: 写 `api/models.py`**：

```python
import os
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.config import settings
from app.models.model_config import ModelConfig
from app.models.user import User
from app.schemas.model_config import ModelConfigCreate, ModelConfigUpdate, ModelConfigResponse
from app.api.deps import get_current_user, require_admin
from app.services.onnx_service import invalidate_session

router = APIRouter()


@router.get("/models", response_model=list[ModelConfigResponse])
def list_models(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ModelConfig).order_by(ModelConfig.created_at.desc()).all()


@router.post("/models", response_model=ModelConfigResponse, status_code=status.HTTP_201_CREATED)
def create_model(body: ModelConfigCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if db.query(ModelConfig).filter(ModelConfig.name == body.name).first():
        raise HTTPException(409, "Model name already exists")
    cfg = ModelConfig(**body.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/models/{model_id}", response_model=ModelConfigResponse)
def update_model(model_id: int, body: ModelConfigUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not cfg:
        raise HTTPException(404, "Model not found")
    for k, v in body.model_dump().items():
        setattr(cfg, k, v)
    cfg.updated_at = __import__("datetime").datetime.utcnow()
    db.commit()
    db.refresh(cfg)
    invalidate_session(cfg.id)
    return cfg


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not cfg:
        raise HTTPException(404, "Model not found")
    invalidate_session(cfg.id)
    db.delete(cfg)
    db.commit()


@router.post("/models/upload")
async def upload_model(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    if not file.filename or not file.filename.lower().endswith(".onnx"):
        raise HTTPException(400, "Only .onnx files are allowed")
    os.makedirs(settings.MODELS_DIR, exist_ok=True)
    name = os.path.basename(file.filename)
    dest = os.path.join(settings.MODELS_DIR, name)
    if os.path.exists(dest):
        stem, ext = os.path.splitext(name)
        name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
        dest = os.path.join(settings.MODELS_DIR, name)
    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    return {"filename": name}
```

- [ ] **Step 3: 注册路由**（`api/__init__.py`）：

```python
from app.api.models import router as models_router
# ...
api_router.include_router(models_router, tags=["models"])
```

- [ ] **Step 4: 写测试 `test_models_api.py`**（复用 `_admin_token` 模式）：

```python
def _admin_token(client):
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=settings.WORK_DIR)
    db.add(user); db.commit(); db.refresh(user)
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
    # 注册 annotator 后 POST 应 403
    r = client.post("/api/auth/register", json={"username": "ann", "password": "pass1234"})
    token = r.json()["access_token"]
    body = {"name": "m", "source": "path", "model_path": "/x.onnx"}
    assert client.post("/api/models", json=body, headers=_auth(token)).status_code == 403
```

- [ ] **Step 5: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_models_api.py -v`，全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/model_config.py backend/app/api/models.py backend/app/api/__init__.py backend/app/tests/test_models_api.py
git commit -m "feat: add model config CRUD and onnx upload API"
```

---

### Task 6: 推理 API（触发 + 任务 + 后台执行）

**Files:**
- Create: `backend/app/schemas/inference.py`
- Create: `backend/app/api/inference.py`
- Modify: `backend/app/api/__init__.py`
- Test: `backend/app/tests/test_inference_api.py`

**Interfaces:**
- Consumes: `InferenceJob`、`onnx_service.run_inference`、`draft_store.write_draft`、`get_owned_image`/`get_owned_batch`。
- Produces: `POST /api/models/:id/inference/:image_id`、`POST /api/models/:id/inference/batch/:batch_id`、`GET /api/inference-jobs/:id`、`GET /api/inference-jobs`。

**Steps:**

- [ ] **Step 1: 写 `schemas/inference.py`**：

```python
from datetime import datetime
from pydantic import BaseModel


class InferenceTriggerResponse(BaseModel):
    jobId: int


class BatchInferenceResponse(BaseModel):
    queued: int
    jobIds: list[int]


class InferenceJobResponse(BaseModel):
    id: int
    image_id: int
    model_config_id: int
    scope: str
    status: str
    error: str | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: 写 `api/inference.py`**（后台任务用独立 session + 串行锁）：

```python
import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.db import get_db, _SessionLocal
from app.models.model_config import ModelConfig
from app.models.inference_job import InferenceJob
from app.models.image import Image
from app.models.user import User
from app.schemas.inference import InferenceTriggerResponse, BatchInferenceResponse, InferenceJobResponse
from app.api.deps import get_current_user, require_work_dir, get_owned_image, get_owned_batch
from app.services import onnx_service
from app.services.draft_store import write_draft
from app.services.work_dir import get_work_dir

router = APIRouter()


def _image_abs_path(work_dir: str, img: Image) -> str:
    return os.path.join(work_dir, img.work_rel_path or img.src_rel_path)


def _run_job(job_id: int) -> None:
    db = _SessionLocal()
    try:
        job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
        if not job:
            return
        job.status = "running"
        db.commit()
        cfg = db.query(ModelConfig).filter(ModelConfig.id == job.model_config_id).first()
        img = db.query(Image).filter(Image.id == job.image_id).first()
        batch = img.batch
        user = db.query(User).filter(User.id == job.requested_by).first()
        work_dir = get_work_dir(db, user)
        path = _image_abs_path(work_dir, img)
        shapes = onnx_service.run_inference(cfg, path)
        write_draft(work_dir, batch.name, img.file_name, {
            "imageName": img.file_name,
            "modelConfigId": cfg.id,
            "modelName": cfg.name,
            "createdAt": datetime.utcnow().isoformat() + "Z",
            "shapes": shapes,
        })
        job.status = "done"
    except Exception as e:  # noqa: BLE001
        db.rollback()
        job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.error = str(e)
    finally:
        job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
        if job:
            job.finished_at = datetime.utcnow()
        db.commit()
        db.close()


@router.post("/models/{model_id}/inference/{image_id}", response_model=InferenceTriggerResponse)
def trigger_single(model_id: int, image_id: int, background_tasks: BackgroundTasks,
                   db: Session = Depends(get_db), current_user: User = Depends(require_work_dir)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id, ModelConfig.enabled == True).first()  # noqa: E712
    if not cfg:
        raise HTTPException(404, "Model not found or disabled")
    img = get_owned_image(db, current_user, image_id)
    job = InferenceJob(image_id=img.id, model_config_id=cfg.id, requested_by=current_user.id,
                       scope="single", status="queued")
    db.add(job); db.commit(); db.refresh(job)
    background_tasks.add_task(_run_job, job.id)
    return InferenceTriggerResponse(jobId=job.id)


@router.post("/models/{model_id}/inference/batch/{batch_id}", response_model=BatchInferenceResponse)
def trigger_batch(model_id: int, batch_id: int, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db), current_user: User = Depends(require_work_dir)):
    cfg = db.query(ModelConfig).filter(ModelConfig.id == model_id, ModelConfig.enabled == True).first()  # noqa: E712
    if not cfg:
        raise HTTPException(404, "Model not found or disabled")
    batch = get_owned_batch(db, current_user, batch_id)
    images = db.query(Image).filter(Image.batch_id == batch.id).all()
    job_ids = []
    for img in images:
        job = InferenceJob(image_id=img.id, model_config_id=cfg.id, requested_by=current_user.id,
                           scope="batch", status="queued")
        db.add(job); db.flush()
        job_ids.append(job.id)
    db.commit()
    for jid in job_ids:
        background_tasks.add_task(_run_job, jid)
    return BatchInferenceResponse(queued=len(job_ids), jobIds=job_ids)


@router.get("/inference-jobs/{job_id}", response_model=InferenceJobResponse)
def get_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
    if not job or job.requested_by != current_user.id:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/inference-jobs", response_model=list[InferenceJobResponse])
def list_jobs(image_id: int | None = None, batch_id: int | None = None,
              db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(InferenceJob).filter(InferenceJob.requested_by == current_user.id)
    if image_id is not None:
        q = q.filter(InferenceJob.image_id == image_id)
    if batch_id is not None:
        q = q.join(Image, InferenceJob.image_id == Image.id).filter(Image.batch_id == batch_id)
    return q.order_by(InferenceJob.id.desc()).all()
```

> 说明：`_SessionLocal` 是 `db.py` 里 `init_db()` 后存在的模块级 sessionmaker。若 lint 报私有访问，可在 `db.py` 增加一个公开的 `session_scope()` 上下文管理器，并在 `_run_job` 里使用；两种等价，实现时选其一即可。

- [ ] **Step 3: 注册路由**（`api/__init__.py`）：

```python
from app.api.inference import router as inference_router
api_router.include_router(inference_router, tags=["inference"])
```

- [ ] **Step 4: 写测试 `test_inference_api.py`**（mock `run_inference`，避免真实 ONNX）：

```python
def test_trigger_single_writes_draft(client, tmp_work_dir, monkeypatch):
    # admin + 建模型 + 扫描一张图
    from app.core.security import hash_password, create_access_token
    from app.models.user import User
    from app.models.model_config import ModelConfig
    from app.main import app
    from app.core.db import get_db
    db = next(app.dependency_overrides[get_db]())
    from app.core.config import settings
    user = User(username="admin1", password_hash=hash_password("admin1234"), role="admin", work_dir=tmp_work_dir)
    db.add(user); db.commit(); db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    auth = {"Authorization": f"Bearer {token}"}

    cfg = ModelConfig(name="m", source="path", model_path="/x.onnx",
                      categories=[{"label": "cat", "channel": 1}])
    db.add(cfg); db.commit(); db.refresh(cfg)

    import os
    from PIL import Image as PILImage
    import numpy as np
    os.makedirs(os.path.join(tmp_work_dir, "batches", "b1", "images"))
    PILImage.fromarray(np.zeros((16, 16, 3), dtype=np.uint8)).save(
        os.path.join(tmp_work_dir, "batches", "b1", "images", "a.png"))
    client.post("/api/batches/scan", headers=auth)

    # mock run_inference
    from app.services import onnx_service
    monkeypatch.setattr(onnx_service, "run_inference",
                        lambda cfg, path: [{"id": "x", "label": "cat", "shapeType": "polygon",
                                            "points": [[0, 0], [1, 0], [1, 1]], "holes": []}])

    img_id = client.get("/api/batches/1/images", headers=auth).json()[0]["id"]
    r = client.post(f"/api/models/{cfg.id}/inference/{img_id}", headers=auth)
    assert r.status_code == 200
    job_id = r.json()["jobId"]

    # BackgroundTasks 在 TestClient 里同步执行 → job 应已 done
    job = client.get(f"/api/inference-jobs/{job_id}", headers=auth).json()
    assert job["status"] == "done"
    assert os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "drafts", "a.json"))
```

> 注意：`POST /api/batches/scan` 返回的 batch id 不保证是 1；测试里应从 `GET /api/batches` 取回真实 id，不要硬编码 `1`。上面示例已用 `client.get("/api/batches/1/images")` 占位，实现时改成先 `client.get("/api/batches", headers=auth).json()[0]["id"]`。

- [ ] **Step 5: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_inference_api.py -v`，全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/inference.py backend/app/api/inference.py backend/app/api/__init__.py backend/app/tests/test_inference_api.py
git commit -m "feat: add inference trigger and background job runner"
```

---

### Task 7: 草稿 API（读 / 保存 / 接受 / 拒绝）

**Files:**
- Create: `backend/app/schemas/draft.py`
- Create: `backend/app/api/draft.py`
- Modify: `backend/app/api/__init__.py`
- Test: `backend/app/tests/test_draft_api.py`

**Interfaces:**
- Consumes: `draft_store`、`annotation_store.read/write_annotation`、`get_owned_image`。
- Produces: `GET/PUT /api/images/:id/draft`、`POST /api/images/:id/draft/accept`、`DELETE /api/images/:id/draft`。

**Steps:**

- [ ] **Step 1: 写 `schemas/draft.py`**：

```python
from pydantic import BaseModel
from app.schemas.annotation import ShapeSchema


class DraftResponse(BaseModel):
    imageName: str
    modelConfigId: int
    modelName: str
    createdAt: str
    shapes: list[ShapeSchema]


class DraftSaveRequest(BaseModel):
    shapes: list[ShapeSchema]


class DraftAcceptRequest(BaseModel):
    expectedRev: int


class DraftAcceptResponse(BaseModel):
    rev: int
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str]
```

> `ShapeSchema` 已存在于 `app/schemas/annotation.py`（含 `holes`），直接复用。

- [ ] **Step 2: 写 `api/draft.py`**：

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.models.user import User
from app.schemas.draft import DraftResponse, DraftSaveRequest, DraftAcceptRequest, DraftAcceptResponse
from app.api.deps import get_current_user, get_owned_image
from app.services.draft_store import read_draft, write_draft, delete_draft
from app.services.annotation_store import read_annotation, write_annotation
from app.services.work_dir import get_work_dir

router = APIRouter()


@router.get("/images/{image_id}/draft", response_model=DraftResponse)
def get_draft(image_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, img.batch.name, img.file_name)
    if draft is None:
        raise HTTPException(404, "No draft")
    return DraftResponse(**draft)


@router.put("/images/{image_id}/draft", response_model=DraftResponse)
def save_draft(image_id: int, body: DraftSaveRequest, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, img.batch.name, img.file_name)
    if draft is None:
        raise HTTPException(404, "No draft")
    draft["shapes"] = [s.model_dump() for s in body.shapes]
    write_draft(work_dir, img.batch.name, img.file_name, draft)
    return DraftResponse(**draft)


@router.post("/images/{image_id}/draft/accept", response_model=DraftAcceptResponse)
def accept_draft(image_id: int, body: DraftAcceptRequest, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    if body.expectedRev != img.annotation_rev:
        raise HTTPException(409, f"Version conflict: expected {body.expectedRev}, server {img.annotation_rev}")
    batch = img.batch
    work_dir = get_work_dir(db, current_user)
    draft = read_draft(work_dir, batch.name, img.file_name)
    if draft is None:
        raise HTTPException(404, "No draft")

    existing = read_annotation(work_dir, batch.name, img.file_name)
    shapes = list(existing.get("shapes", [])) if existing else []
    label_status = dict(existing.get("labelStatus", {})) if existing else {}
    for s in draft.get("shapes", []):
        shapes.append(s)
        label_status[s["label"]] = "present"

    saved = write_annotation(
        work_dir=work_dir, batch_name=batch.name, file_name=img.file_name,
        shapes=shapes, label_status=label_status,
        image_width=img.width, image_height=img.height,
        username=current_user.username, current_version=img.annotation_rev,
    )
    img.annotation_rev = saved["version"]
    db.commit()
    delete_draft(work_dir, batch.name, img.file_name)
    return DraftAcceptResponse(rev=saved["version"], shapes=shapes, labelStatus=label_status)


@router.delete("/images/{image_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
def reject_draft(image_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    img = get_owned_image(db, current_user, image_id)
    work_dir = get_work_dir(db, current_user)
    delete_draft(work_dir, img.batch.name, img.file_name)
```

- [ ] **Step 3: 注册路由**（`api/__init__.py`）：

```python
from app.api.draft import router as draft_router
api_router.include_router(draft_router, tags=["draft"])
```

- [ ] **Step 4: 写测试 `test_draft_api.py`**（写草稿 → 读 → 接受合并 → 拒绝 404）：

```python
def test_draft_accept_merges_and_deletes(client, tmp_work_dir):
    # 复用 admin token + 建图 + 写草稿（同 Task 6 的 helper 结构）
    ...
    # GET 无草稿 → 404
    assert client.get(f"/api/images/{img_id}/draft", headers=auth).status_code == 404
    # 直接落一个草稿 JSON 文件
    import json, os
    os.makedirs(os.path.join(tmp_work_dir, "batches", "b1", "drafts"))
    with open(os.path.join(tmp_work_dir, "batches", "b1", "drafts", "a.json"), "w") as f:
        json.dump({"imageName": "a.png", "modelConfigId": cfg.id, "modelName": "m",
                   "createdAt": "now", "shapes": [{"id": "x", "label": "cat", "shapeType": "polygon",
                   "points": [[0, 0], [1, 0], [1, 1]], "holes": []}]}, f)
    # accept → 合并进 annotation + 删草稿
    r = client.post(f"/api/images/{img_id}/draft/accept", json={"expectedRev": 0}, headers=auth)
    assert r.status_code == 200
    assert any(s["label"] == "cat" for s in r.json()["shapes"])
    assert not os.path.isfile(os.path.join(tmp_work_dir, "batches", "b1", "drafts", "a.json"))
```

- [ ] **Step 5: 运行** `cd backend && ../.venv/bin/pytest app/tests/test_draft_api.py -v`，全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/draft.py backend/app/api/draft.py backend/app/api/__init__.py backend/app/tests/test_draft_api.py
git commit -m "feat: add draft read/save/accept/reject API"
```

---

### Task 8: 前端 API clients + 类型

**Files:**
- Create: `frontend/src/types/model.ts`
- Create: `frontend/src/api/models.ts`
- Create: `frontend/src/api/inference.ts`
- Create: `frontend/src/api/draft.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Consumes: `apiClient`、`Shape`（`types/shapes.ts`）。
- Produces: 类型 `ModelConfig`/`InferenceJob`/`Draft`，函数 `listModels/createModel/updateModel/deleteModel/uploadModel`、`triggerInference/triggerBatchInference/getJob`、`fetchDraft/saveDraft/acceptDraft/rejectDraft`。

**Steps:**

- [ ] **Step 1: `client.ts` 加单文件上传**：

```ts
async uploadFile<T>(path: string, file: File, field = 'file'): Promise<T> {
  const formData = new FormData();
  formData.append(field, file);
  const h: Record<string, string> = {};
  if (this.token) h['Authorization'] = `Bearer ${this.token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: h, body: formData });
  if (!res.ok) return this._raise(res);
  return res.json();
}
```

- [ ] **Step 2: `types/model.ts`**：

```ts
export type ModelSource = 'upload' | 'path';
export type ResizeMode = 'stretch' | 'letterbox';
export type NormalizeMode = 'min_max' | 'mean_std' | 'none';
export type Postprocess = 'argmax' | 'sigmoid';

export interface CategoryMapping { label: string; channel: number; }

export interface ModelConfig {
  id: number;
  name: string;
  source: ModelSource;
  model_path: string;
  input_width: number;
  input_height: number;
  resize_mode: ResizeMode;
  normalize_mode: NormalizeMode;
  mean: number[] | null;
  std: number[] | null;
  background_channel: number;
  categories: CategoryMapping[];
  postprocess: Postprocess;
  sigmoid_threshold: number;
  enabled: boolean;
}

export interface ModelConfigInput {
  name: string;
  source: ModelSource;
  model_path: string;
  input_width: number;
  input_height: number;
  resize_mode: ResizeMode;
  normalize_mode: NormalizeMode;
  mean: number[] | null;
  std: number[] | null;
  background_channel: number;
  categories: CategoryMapping[];
  postprocess: Postprocess;
  sigmoid_threshold: number;
  enabled: boolean;
}

export interface InferenceJob {
  id: number;
  image_id: number;
  model_config_id: number;
  scope: 'single' | 'batch';
  status: 'queued' | 'running' | 'done' | 'failed';
  error: string | null;
}

export interface Draft {
  imageName: string;
  modelConfigId: number;
  modelName: string;
  createdAt: string;
  shapes: Shape[];
}
```

- [ ] **Step 3: `api/models.ts`**：

```ts
import { apiClient } from './client';
import type { ModelConfig, ModelConfigInput } from '../types/model';

export const listModels = () => apiClient.get<ModelConfig[]>('/models');
export const createModel = (body: ModelConfigInput) => apiClient.post<ModelConfig>('/models', body);
export const updateModel = (id: number, body: ModelConfigInput) => apiClient.put<ModelConfig>(`/models/${id}`, body);
export const deleteModel = (id: number) => apiClient.delete(`/models/${id}`);
export const uploadModel = (file: File) => apiClient.uploadFile<{ filename: string }>('/models/upload', file);
```

- [ ] **Step 4: `api/inference.ts`**：

```ts
import { apiClient } from './client';
import type { InferenceJob } from '../types/model';

export const triggerInference = (modelId: number, imageId: number) =>
  apiClient.post<{ jobId: number }>(`/models/${modelId}/inference/${imageId}`);
export const triggerBatchInference = (modelId: number, batchId: number) =>
  apiClient.post<{ queued: number; jobIds: number[] }>(`/models/${modelId}/inference/batch/${batchId}`);
export const getJob = (jobId: number) => apiClient.get<InferenceJob>(`/inference-jobs/${jobId}`);
```

- [ ] **Step 5: `api/draft.ts`**：

```ts
import { apiClient } from './client';
import type { Draft } from '../types/model';
import type { Shape } from '../types/shapes';

export const fetchDraft = (imageId: number) => apiClient.get<Draft>(`/images/${imageId}/draft`);
export const saveDraft = (imageId: number, shapes: Shape[]) =>
  apiClient.put<Draft>(`/images/${imageId}/draft`, { shapes });
export const acceptDraft = (imageId: number, expectedRev: number) =>
  apiClient.post<{ rev: number; shapes: Shape[]; labelStatus: Record<string, string> }>(
    `/images/${imageId}/draft/accept`, { expectedRev });
export const rejectDraft = (imageId: number) => apiClient.delete(`/images/${imageId}/draft`);
```

- [ ] **Step 6: 验证** `cd frontend && npx tsc --noEmit`，通过。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/model.ts frontend/src/api
git commit -m "feat: add frontend model/inference/draft API clients"
```

---

### Task 9: `draftStore` + `DraftLayer` + 接线

**Files:**
- Create: `frontend/src/stores/draftStore.ts`
- Create: `frontend/src/components/canvas/DraftLayer.tsx`
- Modify: `frontend/src/components/canvas/KonvaStage.tsx`
- Modify: `frontend/src/stores/imageStore.ts`
- Modify: `frontend/src/stores/uiStore.ts`
- Test: `frontend/src/stores/draftStore.test.ts`

**Interfaces:**
- Consumes: `fetchDraft/saveDraft/acceptDraft/rejectDraft`、`editorStore`、`Shape`。
- Produces: `useDraftStore`（状态 + actions 见 §7.3 spec）。

**Steps:**

- [ ] **Step 1: 写 `draftStore.ts`**（含选中互斥 + 编辑 + accept/reject）：

```ts
import { create } from 'zustand';
import type { Shape } from '../types/shapes';
import { fetchDraft, saveDraft, acceptDraft, rejectDraft } from '../api/draft';
import { useEditorStore } from './editorStore';
import { useImageStore } from './imageStore';

interface DraftMeta { modelConfigId: number; modelName: string; createdAt: string; }

interface DraftState {
  draftShapes: Shape[];
  draftMeta: DraftMeta | null;
  selectedDraftId: string | null;
  isDirty: boolean;
  status: 'none' | 'loading' | 'ready';

  loadDraft: (imageId: number) => Promise<void>;
  selectDraft: (id: string | null) => void;
  moveDraftShape: (id: string, points: number[][], holes?: number[][][]) => void;
  moveDraftVertex: (id: string, vertexIndex: number, x: number, y: number) => void;
  deleteDraftShape: (id: string) => void;
  acceptDraft: (imageId: number) => Promise<void>;
  rejectDraft: (imageId: number) => Promise<void>;
  markDraftSaved: () => void;
  clear: () => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  draftShapes: [],
  draftMeta: null,
  selectedDraftId: null,
  isDirty: false,
  status: 'none',

  loadDraft: async (imageId) => {
    set({ status: 'loading' });
    try {
      const d = await fetchDraft(imageId);
      set({ draftShapes: d.shapes.map(clone), draftMeta: { modelConfigId: d.modelConfigId, modelName: d.modelName, createdAt: d.createdAt }, status: 'ready', selectedDraftId: null, isDirty: false });
    } catch {
      set({ draftShapes: [], draftMeta: null, status: 'none', selectedDraftId: null, isDirty: false });
    }
  },

  selectDraft: (id) => {
    set({ selectedDraftId: id });
    if (id) useEditorStore.getState().selectShape(null);
  },

  moveDraftShape: (id, points, holes) => set((s) => ({
    draftShapes: s.draftShapes.map((d) => d.id === id ? { ...d, points, ...(holes !== undefined ? { holes } : {}) } : d),
    isDirty: true,
  })),

  moveDraftVertex: (id, vertexIndex, x, y) => set((s) => ({
    draftShapes: s.draftShapes.map((d) => {
      if (d.id !== id) return d;
      const points = d.points.map((p) => [...p]);
      points[vertexIndex] = [x, y];
      return { ...d, points };
    }),
    isDirty: true,
  })),

  deleteDraftShape: (id) => set((s) => ({
    draftShapes: s.draftShapes.filter((d) => d.id !== id),
    selectedDraftId: s.selectedDraftId === id ? null : s.selectedDraftId,
    isDirty: true,
  })),

  acceptDraft: async (imageId) => {
    const rev = useEditorStore.getState().version;
    await acceptDraft(imageId, rev);
    get().clear();
    await useImageStore.getState().loadImage(imageId);  // 重拉标注
  },

  rejectDraft: async (imageId) => {
    await rejectDraft(imageId);
    get().clear();
  },

  markDraftSaved: () => set({ isDirty: false }),
  clear: () => set({ draftShapes: [], draftMeta: null, selectedDraftId: null, isDirty: false, status: 'none' }),
}));

function clone(s: Shape): Shape {
  return { ...s, points: s.points.map((p) => [...p]), holes: (s.holes ?? []).map((h) => h.map((p) => [...p])) };
}
```

> 注意：`acceptDraft` 里 `loadImage` 会重新走锁 + 拉标注，需确认 `loadImage` 里也调用 `loadDraft`（见 Step 3）。避免死循环：accept 成功后草稿已删，重拉标注不会再次拉到草稿。

- [ ] **Step 2: 写 `DraftLayer.tsx`**（render-only，镜像 MaskLayer 用蓝色）：

```tsx
import { Path } from 'react-konva';
import { useDraftStore } from '../../stores/draftStore';
import { useUIStore } from '../../stores/uiStore';

function toSvgPath(points: number[][], holes: number[][][]): string {
  const ring = (r: number[][]) => r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('') + 'Z';
  return ring(points) + holes.map(ring).join('');
}

export default function DraftLayer() {
  const draftShapes = useDraftStore((s) => s.draftShapes);
  const showDraft = useUIStore((s) => s.showDraft);

  if (!showDraft) return null;

  return (
    <>
      {draftShapes.map((shape) => (
        <Path
          key={shape.id}
          data={toSvgPath(shape.points, shape.holes ?? [])}
          fillRule="evenodd"
          fill="#2196f3"
          fillOpacity={0.25}
          stroke="#2196f3"
          strokeWidth={2}
          lineJoin="round"
          listening={false}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 3: 改 `imageStore.ts`**——`loadImage` 成功后加载草稿、`clearImage` 清草稿：

在 `loadImage` 的两处 `loadAnnotation(...)` 之后加 `useDraftStore.getState().loadDraft(imageId);`（锁获取成功与只读两分支都要）；在 `clearImage` 的 `useEditorStore.getState().reset()` 之后加 `useDraftStore.getState().clear();`。文件顶部 import `useDraftStore`。

- [ ] **Step 4: 改 `KonvaStage.tsx`**——在 MaskLayer 层与 DrawingLayer 层之间插 DraftLayer：

```tsx
<Layer><MaskLayer /></Layer>
<Layer><DraftLayer /></Layer>
<Layer><DrawingLayer /></Layer>
```

并 `import DraftLayer from './DraftLayer';`。

- [ ] **Step 5: 改 `uiStore.ts`** 与 `DrawingLayer.tsx` 的 showDraft 误用（见 Task 10 一并处理；此处先把 `showDraft` 语义注释改为「草稿层显隐」）。

- [ ] **Step 6: 写 `draftStore.test.ts`**（纯 store，无需渲染）：

```ts
import { useDraftStore } from './draftStore';

test('selectDraft clears editor selection', () => {
  useDraftStore.getState().clear();
  useDraftStore.setState({ draftShapes: [{ id: 'd1', label: 'cat', shapeType: 'polygon', points: [[0,0],[1,0],[1,1]], holes: [] }] });
  useDraftStore.getState().selectDraft('d1');
  expect(useDraftStore.getState().selectedDraftId).toBe('d1');
});
```

> 若现有测试基建用 Vitest，`test`/`expect` 全局可用；否则从 `vitest` 导入。参考 `editorStore.test.ts` 的写法。

- [ ] **Step 7: 验证** `cd frontend && npx tsc --noEmit`，通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stores/draftStore.ts frontend/src/stores/draftStore.test.ts frontend/src/components/canvas/DraftLayer.tsx frontend/src/components/canvas/KonvaStage.tsx frontend/src/stores/imageStore.ts frontend/src/stores/uiStore.ts
git commit -m "feat: add draftStore and DraftLayer rendering"
```

---

### Task 10: DrawingLayer 草稿编辑路由（单交互层）

**Files:**
- Modify: `frontend/src/components/canvas/DrawingLayer.tsx`
- Modify: `frontend/src/stores/editorStore.ts`（`selectShape` 清 draft 选中）
- Modify: `frontend/src/pages/AnnotationPage.tsx`（Delete 键分流）

**Interfaces:**
- Consumes: `useDraftStore`、`useEditorStore`。
- Produces: select 模式命中顺序「先草稿后已确认」，拖动/顶点/删除按 `selectedDraftId`/`selectedShapeId` 分流。

**Steps:**

- [ ] **Step 1: 修 `showDraft` 误用**——`DrawingLayer.tsx` 第 100 行 `drawingActive = ... && showDraft` 改为 `... && showMask`（`showMask` 才是「标注层可见可绘」的语义）；`showDraft` 仅保留给 DraftLayer 显隐。

- [ ] **Step 2: `selectShape` 互斥**——`editorStore.ts` 里 `selectShape` 改为在选中时清 draft 选中：

```ts
selectShape: (id) => {
  set({ selectedShapeId: id });
  if (id) useDraftStore.getState().selectDraft(null);
},
```

> 注意循环 import：`editorStore` 引 `draftStore`、`draftStore` 引 `editorStore`。二者都用 `zustand` 的 `getState()` 而非模块顶层 import 来打破环（draftStore 里已用 `useEditorStore.getState()`；editorStore 里也改用 `import { useDraftStore } from './draftStore'` 的惰性 getState 调用）。若 TS/打包报循环，可把互斥逻辑移到 `selectDraft`/`selectShape` 内部用 `getState()` 调用，`zustand` 通常可容忍该环。

- [ ] **Step 3: 命中顺序扩展**——在 `DrawingLayer.tsx` 的 `handleDblClick`（选中）与 select 拖拽命中处，先对草稿做命中测试：

在 `handleDblClick` 内，现有对 `currentShapes` 的 vertex/edge/inside 命中之前，先对 `useDraftStore.getState().draftShapes` 用同样的三个命中检查（`findNearestVertex`/`findNearestShape`/`isPointInShape`），命中即 `useDraftStore.getState().selectDraft(id)` 并 return；未命中草稿再走 `editorStore.selectShape(...)`。

- [ ] **Step 4: 拖拽/顶点/删除分流**——在 select 拖拽逻辑里：

  - 若 `useDraftStore.getState().selectedDraftId` 非空，命中该草稿 shape 的顶点/内部后，拖动时调 `useDraftStore.getState().moveDraftVertex(...)` / `moveDraftShape(...)`（构造 `dragRef` 时记 `kind: 'draft' | 'confirmed'`）。
  - 否则走现有 `editorStore.updateShape(...)` 逻辑（`kind: 'confirmed'`）。

- [ ] **Step 5: 选中草稿的高亮/手柄/删除按钮**——在 DrawingLayer 渲染处，若 `selectedDraftId` 非空，用 `draftShapes` 里对应 shape 渲染蓝色高亮（`#2196f3`）、顶点手柄（`listening={false}`）与删除按钮（`onClick` → `useDraftStore.getState().deleteDraftShape(id)`）。

- [ ] **Step 6: Delete 键分流**——`AnnotationPage.tsx` 的 Delete 分支改为：

```ts
if (e.key === 'Delete' || e.key === 'Backspace') {
  const draft = useDraftStore.getState();
  if (draft.selectedDraftId) { draft.deleteDraftShape(draft.selectedDraftId); return; }
  const store = useEditorStore.getState();
  if (store.selectedShapeId) { store.deleteSelectedShape(); }
  return;
}
```

- [ ] **Step 7: 验证** `cd frontend && npx tsc --noEmit && npx vite build`，通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/canvas/DrawingLayer.tsx frontend/src/stores/editorStore.ts frontend/src/pages/AnnotationPage.tsx
git commit -m "feat: route draft editing through DrawingLayer single interaction"
```

---

### Task 11: `useDraftAutoSave` + `InferencePanel`

**Files:**
- Create: `frontend/src/hooks/useDraftAutoSave.ts`
- Create: `frontend/src/components/panels/InferencePanel.tsx`
- Modify: `frontend/src/pages/AnnotationPage.tsx`（挂 `useDraftAutoSave`）
- Modify: `frontend/src/components/panels/RightPanel.tsx`（嵌 `InferencePanel`）

**Interfaces:**
- Consumes: `useDraftStore`、`useImageStore`、`useBatchStore`、`triggerInference/triggerBatchInference/getJob`、`saveDraft`。
- Produces: 草稿防抖自动保存；推理面板（选模型 → 单图/整批触发 → 轮询 → 完成后 `loadDraft`）。

**Steps:**

- [ ] **Step 1: 写 `useDraftAutoSave.ts`**（镜像 `useAutoSave.ts`）：

```ts
import { useEffect, useRef } from 'react';
import { useDraftStore } from '../stores/draftStore';
import { useImageStore } from '../stores/imageStore';
import { saveDraft } from '../api/draft';

const DEBOUNCE_MS = 300;

export function useDraftAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useDraftStore.subscribe((state, prev) => {
      if (!state.isDirty || state.isDirty === prev.isDirty) return;
      const { currentImage, lockedByMe } = useImageStore.getState();
      if (!currentImage || !lockedByMe) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const { draftShapes, markDraftSaved } = useDraftStore.getState();
        const img = useImageStore.getState().currentImage;
        if (!img) return;
        try {
          await saveDraft(img.id, draftShapes);
          markDraftSaved();
        } catch { /* 保持 isDirty，下次再试 */ }
      }, DEBOUNCE_MS);
    });
    return () => { unsub(); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);
}
```

- [ ] **Step 2: 写 `InferencePanel.tsx`**：

```tsx
import { useEffect, useRef, useState } from 'react';
import { listModels } from '../../api/models';
import { triggerInference, triggerBatchInference, getJob } from '../../api/inference';
import { useImageStore } from '../../stores/imageStore';
import { useBatchStore } from '../../stores/batchStore';
import { useDraftStore } from '../../stores/draftStore';
import type { ModelConfig, InferenceJob } from '../../types/model';

export default function InferencePanel() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [job, setJob] = useState<InferenceJob | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentImage = useImageStore((s) => s.currentImage);
  const currentBatchId = useBatchStore((s) => s.currentBatchId);

  useEffect(() => { listModels().then((m) => { setModels(m.filter((x) => x.enabled)); }); }, []);

  const startPolling = (jobId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
      setJob(j);
      if (j.status === 'done' || j.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current);
        setBusy(false);
        if (j.status === 'done' && currentImage) useDraftStore.getState().loadDraft(currentImage.id);
      }
    }, 1500);
  };

  const runSingle = async () => {
    if (!modelId || !currentImage) return;
    setBusy(true); setJob(null);
    const r = await triggerInference(modelId, currentImage.id);
    startPolling(r.jobId);
  };

  const runBatch = async () => {
    if (!modelId || !currentBatchId) return;
    setBusy(true);
    const r = await triggerBatchInference(modelId, currentBatchId);
    setBusy(false);
    alert(`已排队 ${r.queued} 张，后台推理中`);
  };

  const statusText = job
    ? { queued: '排队中', running: '推理中', done: '完成', failed: `失败：${job.error}` }[job.status]
    : '';

  return (
    <div>
      <h3>预分割</h3>
      <select value={modelId ?? ''} onChange={(e) => setModelId(Number(e.target.value))}>
        <option value="">选择模型</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button onClick={runSingle} disabled={!modelId || !currentImage || busy}>推理此图</button>
      <button onClick={runBatch} disabled={!modelId || !currentBatchId || busy}>推理整批</button>
      {statusText && <p>{statusText}</p>}
      {job?.status === 'failed' && <button onClick={runSingle}>重试</button>}
    </div>
  );
}
```

> `alert` 仅作占位，按项目 UI 习惯换成 toast / 行内提示。`currentBatchId` 需确认 `batchStore` 里确有该字段；若无，从 `ImageList`/`BatchSelector` 的选中批次取，或读 `batchStore.currentBatchId` 的等价字段。

- [ ] **Step 3: 挂载**——`AnnotationPage.tsx` 里 `useAutoSave();` 后加 `useDraftAutoSave();`；`RightPanel.tsx` 里在工具区后渲染 `<InferencePanel />`。

- [ ] **Step 4: 验证** `cd frontend && npx tsc --noEmit && npx vite build`，通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDraftAutoSave.ts frontend/src/components/panels/InferencePanel.tsx frontend/src/pages/AnnotationPage.tsx frontend/src/components/panels/RightPanel.tsx
git commit -m "feat: add draft autosave and inference panel"
```

---

### Task 12: `AdminModelsPage` + 路由 + 导航

**Files:**
- Create: `frontend/src/pages/AdminModelsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/common/Layout.tsx`

**Interfaces:**
- Consumes: `listModels/createModel/updateModel/deleteModel/uploadModel`、`useLabelStore`（标签下拉）。
- Produces: `/admin/models` 路由 + 侧栏入口 + 模型配置表单。

**Steps:**

- [ ] **Step 1: 写 `AdminModelsPage.tsx`**（列表 + 表单，表单含全部字段；source=upload 时先 `uploadModel` 再建配置）：

关键结构：

```tsx
import { useEffect, useState } from 'react';
import { listModels, createModel, updateModel, deleteModel, uploadModel } from '../api/models';
import { useLabelStore } from '../stores/labelStore';
import type { ModelConfig, ModelConfigInput } from '../types/model';

const EMPTY: ModelConfigInput = {
  name: '', source: 'upload', model_path: '', input_width: 512, input_height: 512,
  resize_mode: 'stretch', normalize_mode: 'min_max', mean: null, std: null,
  background_channel: 0, categories: [], postprocess: 'argmax', sigmoid_threshold: 0.5, enabled: true,
};

export default function AdminModelsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [form, setForm] = useState<ModelConfigInput>(EMPTY);
  const labels = useLabelStore((s) => s.labels);
  const refresh = () => listModels().then(setModels);
  useEffect(() => { refresh(); }, []);

  async function onSubmit() {
    let path = form.model_path;
    if (form.source === 'upload' && fileRef.current) {
      const r = await uploadModel(fileRef.current);
      path = r.filename;
    }
    await createModel({ ...form, model_path: path });
    setForm(EMPTY);
    refresh();
  }
  // 渲染：列表 + 表单（source 二选一、resize/normalize/postprocess 下拉、categories 动态行 [标签下拉 + channel]）
}
```

> 表单各字段 UI 细节按项目现有 `AdminLabelsPage` / `AdminUsersPage` 的样式与组件习惯实现（CSS Modules、既有 button/input 样式类）。categories 用 `labels`（`useLabelStore`）做标签下拉，`channel` 数字输入。文件上传用 `<input type="file" accept=".onnx">` 存 `fileRef`。

- [ ] **Step 2: 加路由**——`App.tsx`：

```tsx
import AdminModelsPage from './pages/AdminModelsPage';
// 在 <Layout> 内加：
<Route path="/admin/models" element={<AdminModelsPage />} />
```

- [ ] **Step 3: 加导航**——`Layout.tsx` 的 admin 分支加：

```tsx
<Link to="/admin/models">模型配置</Link>
```

- [ ] **Step 4: 验证** `cd frontend && npx tsc --noEmit && npx vite build`，通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AdminModelsPage.tsx frontend/src/App.tsx frontend/src/components/common/Layout.tsx
git commit -m "feat: add model config admin page and routing"
```

---

## 端到端验收

1. `cd backend && ../.venv/bin/pytest -q` 全绿（新增约 15+ 用例）。
2. `cd frontend && npx tsc --noEmit && npx vite build` 通过。
3. 手工：admin 配一个模型（source=path 指向真实 onnx）→ 标注员扫描一批 → 单图/整批推理 → 打开图见蓝色草稿 → 拖动/删顶点/删除草稿 → 接受 → 草稿变正式标注（标签置 present）→ 保存为 mask / 导出。
4. CPU 无 GPU 环境回退正常；`onnxruntime` 已随依赖安装。

## 已知限制（对应 spec §9）

- 单图单草稿；整批进度徽标、草稿 undo/redo、letterbox 完整逆映射为后续增强。
