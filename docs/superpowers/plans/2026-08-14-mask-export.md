# 保存 mask（多边形 → 二值图导出）+ 标签状态重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加一个「保存 mask」按钮，把当前标注图像按标签导出成二值图（每个标签一张 PNG），并把标签状态改为由标注内容自动推导、待定作为唯一手动标记。

**Architecture:** 后端新增 `mask_export` 服务（`shapes_to_masks` 纯函数 + `export_image_masks` 写文件）与单图导出端点；前端改造 `editorStore` 的标签状态自动维护、`LabelStatusList` 单键切换、`CanvasControls` 导出按钮 + 待定确认弹窗。单图导出与将来批次导出共用同一个 `export_image_masks`。

**Tech Stack:** FastAPI + SQLAlchemy + SQLite（后端）；React + TS + Vite + Zustand + vitest（前端）；OpenCV/Pillow（栅格化）。

## Global Constraints

- mask 目录约定：`batches/<batch>/masks/<标签>/<原图文件名去扩展名>.png`，二值图前景 255 / 背景 0，与导入共用、支持往返。
- 标签状态：`present`（有形状）/ `absent`（无形状）**由内容自动推导**；`pending` 是唯一可手动打的标记；`present ↔ absent` 之间永远不能手动互切。
- 导入初始状态：有 mask 文件且非空 → `present`；有 mask 文件但全黑为空 → `absent`；**没有 mask 文件 → `pending`**（只导入部分标签时其余待定）。
- 导出规则：`present` → 栅格化该标签多边形（填外环 + 挖孔）；`absent` → 全黑；`pending` → 跳过，且若存在 pending 标签则前端弹窗确认是否忽略。
- 端点：`POST /api/images/{image_id}/export-mask`，body 传 `{shapes, labelStatus}`（前端发内存中的当前值，避免自动保存未落盘的竞态），认证 `get_current_user`。
- 向后兼容：旧 JSON 无 `holes` 字段仍可读（pydantic `default_factory=list` + 前端 `?? []`）。

---

### Task 1: 后端栅格化服务 `mask_export.py`

**Files:**
- Create: `backend/app/services/mask_export.py`
- Test: `backend/app/tests/test_mask_export.py`

**Interfaces:**
- Consumes: `shape` dict `{label, points, holes}`（`points` 外环、`holes` 内环列表）；`label_status` dict。
- Produces: `shapes_to_masks(shapes, label_status, width, height) -> dict[str, np.ndarray]`、`export_image_masks(work_dir, batch, image, shapes, label_status) -> dict`（`{saved, errors}`）。

- [ ] **Step 1: 写失败测试** — `backend/app/tests/test_mask_export.py`

```python
import os
import numpy as np
from PIL import Image as PILImage

from app.services.mask_export import shapes_to_masks, export_image_masks


def test_shapes_to_masks_solid_square():
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []}]
    masks = shapes_to_masks(shapes, {"cat": "present"}, 20, 20)
    assert set(masks) == {"cat"}
    assert masks["cat"][5, 5] == 255
    assert masks["cat"][15, 15] == 0


def test_shapes_to_masks_donut_hole():
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
               "holes": [[[5, 5], [15, 5], [15, 15], [5, 15]]]}]
    masks = shapes_to_masks(shapes, {"cat": "present"}, 20, 20)
    assert masks["cat"][2, 2] == 255     # 环内
    assert masks["cat"][10, 10] == 0     # 孔内
    assert masks["cat"][18, 18] == 255   # 环内


def test_shapes_to_masks_absent_black_and_pending_skipped():
    masks = shapes_to_masks([], {"cat": "absent", "dog": "pending"}, 10, 10)
    assert set(masks) == {"cat"}          # pending 跳过
    assert masks["cat"].max() == 0        # absent 全黑


def test_shapes_to_masks_two_labels():
    shapes = [
        {"label": "cat", "shapeType": "polygon", "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []},
        {"label": "dog", "shapeType": "polygon", "points": [[10, 10], [20, 10], [20, 20], [10, 20]], "holes": []},
    ]
    masks = shapes_to_masks(shapes, {"cat": "present", "dog": "present"}, 20, 20)
    assert set(masks) == {"cat", "dog"}
    assert masks["cat"][5, 5] == 255
    assert masks["dog"][15, 15] == 255
    assert masks["cat"][15, 15] == 0


def test_export_image_masks_writes_files(tmp_work_dir):
    from app.models.batch import Batch
    from app.models.image import Image
    batch = Batch(name="b1", source="upload")
    image = Image(batch_id=1, file_name="a.png", width=20, height=20, channels=3)
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": []}]
    result = export_image_masks(tmp_work_dir, batch, image, shapes,
                                {"cat": "present", "dog": "absent"})
    assert result["saved"] == ["cat", "dog"]
    assert result["errors"] == []
    cat = np.array(PILImage.open(
        os.path.join(tmp_work_dir, "batches", "b1", "masks", "cat", "a.png")).convert("L"))
    dog = np.array(PILImage.open(
        os.path.join(tmp_work_dir, "batches", "b1", "masks", "dog", "a.png")).convert("L"))
    assert cat[5, 5] == 255
    assert dog.max() == 0


def test_export_roundtrip_donut(tmp_work_dir):
    from app.models.batch import Batch
    from app.models.image import Image
    from app.services.mask_import import vectorize_mask
    batch = Batch(name="b1", source="upload")
    image = Image(batch_id=1, file_name="a.png", width=40, height=40, channels=3)
    shapes = [{"label": "cat", "shapeType": "polygon",
               "points": [[5, 5], [35, 5], [35, 35], [5, 35]],
               "holes": [[[15, 15], [25, 15], [25, 25], [15, 25]]]}]
    export_image_masks(tmp_work_dir, batch, image, shapes, {"cat": "present"})
    path = os.path.join(tmp_work_dir, "batches", "b1", "masks", "cat", "a.png")
    polys = vectorize_mask(path)
    assert len(polys) == 1
    assert len(polys[0]["holes"]) == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_export.py -q`
Expected: FAIL（`ModuleNotFoundError: app.services.mask_export`）。

- [ ] **Step 3: 实现** — `backend/app/services/mask_export.py`

```python
import os
import cv2
import numpy as np
from PIL import Image as PILImage


def shapes_to_masks(
    shapes: list[dict],
    label_status: dict[str, str],
    width: int,
    height: int,
) -> dict[str, np.ndarray]:
    """按标签状态把 shapes 栅格化成 {标签名: uint8 二值图}。

    present → 填外环 + 挖孔；absent → 全黑；pending → 跳过。
    """
    masks: dict[str, np.ndarray] = {}
    for label, status in label_status.items():
        if status in ("present", "absent"):
            masks[label] = np.zeros((height, width), dtype=np.uint8)

    # 第一遍：填外环
    for shape in shapes:
        label = shape.get("label")
        if label_status.get(label) != "present":
            continue
        outer = np.array(shape["points"], dtype=np.int32)
        if len(outer) >= 3:
            cv2.fillPoly(masks[label], [outer], 255)

    # 第二遍：挖孔（保证孔压过填充，与遍历顺序无关）
    for shape in shapes:
        label = shape.get("label")
        if label_status.get(label) != "present":
            continue
        for hole in shape.get("holes", []):
            inner = np.array(hole, dtype=np.int32)
            if len(inner) >= 3:
                cv2.fillPoly(masks[label], [inner], 0)

    return masks


def export_image_masks(
    work_dir: str,
    batch,
    image,
    shapes: list[dict],
    label_status: dict[str, str],
) -> dict:
    """把单张图的标注按标签写成 masks/<标签>/<原图名>.png。返回 {saved, errors}。"""
    masks = shapes_to_masks(shapes, label_status, image.width, image.height)
    stem = os.path.splitext(image.file_name)[0]
    saved: list[str] = []
    errors: list[dict] = []
    for label, mask_arr in masks.items():
        subdir = os.path.join(work_dir, "batches", batch.name, "masks", label)
        try:
            os.makedirs(subdir, exist_ok=True)
            path = os.path.join(subdir, stem + ".png")
            PILImage.fromarray(mask_arr).save(path)
            saved.append(label)
        except OSError as e:
            errors.append({"label": label, "error": str(e)})
    return {"saved": sorted(saved), "errors": errors}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_export.py -q`
Expected: PASS（6 passed）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/mask_export.py backend/app/tests/test_mask_export.py
git commit -m "feat: rasterize annotation shapes to per-label binary masks"
```

---

### Task 2: 单图导出端点 `POST /images/{id}/export-mask`

**Files:**
- Modify: `backend/app/schemas/annotation.py`
- Modify: `backend/app/api/images.py`
- Test: `backend/app/tests/test_images.py`

**Interfaces:**
- Consumes: Task 1 的 `export_image_masks`；`ShapeSchema`（`schemas/annotation.py`）。
- Produces: `MaskExportRequest {shapes, labelStatus}`、`MaskExportResponse {saved, errors}`；端点返回 `saved` 标签名列表。

- [ ] **Step 1: 写失败测试** — 在 `backend/app/tests/test_images.py` 末尾新增

```python
class TestExportMask:
    def _setup(self, client, tmp_work_dir):
        token = _admin_token(client)
        batches_dir = os.path.join(tmp_work_dir, "batches", "test-batch", "images")
        os.makedirs(batches_dir)
        PILImage.fromarray(np.zeros((50, 50, 3), dtype=np.uint8) + 128).save(
            os.path.join(batches_dir, "sample.png"))
        from app.main import app
        from app.core.db import get_db
        db = next(app.dependency_overrides[get_db]())
        from app.models.batch import Batch
        from app.models.image import Image
        batch = Batch(name="test-batch", source="upload")
        db.add(batch); db.commit(); db.refresh(batch)
        image = Image(batch_id=batch.id, file_name="sample.png",
                      src_rel_path="batches/test-batch/images/sample.png",
                      width=50, height=50, channels=3)
        db.add(image); db.commit(); db.refresh(image)
        return token, image

    def test_export_mask_writes_file(self, client, tmp_work_dir):
        token, image = self._setup(client, tmp_work_dir)
        shapes = [{"id": "x", "label": "cat", "shapeType": "polygon",
                   "points": [[0, 0], [20, 0], [20, 20], [0, 20]], "holes": []}]
        resp = client.post(f"/api/images/{image.id}/export-mask",
                           json={"shapes": shapes,
                                 "labelStatus": {"cat": "present", "dog": "absent"}},
                           headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["saved"] == ["cat", "dog"]
        assert os.path.isfile(os.path.join(
            tmp_work_dir, "batches", "test-batch", "masks", "cat", "sample.png"))

    def test_export_mask_404(self, client):
        token = _admin_token(client)
        resp = client.post("/api/images/99999/export-mask",
                           json={"shapes": [], "labelStatus": {}}, headers=_auth(token))
        assert resp.status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_images.py -q`
Expected: FAIL（404 测试通过，但 `test_export_mask_writes_file` 因端点不存在返回 404/405）。

- [ ] **Step 3: 加 schema** — `backend/app/schemas/annotation.py` 末尾

```python
class MaskExportRequest(BaseModel):
    shapes: list[ShapeSchema]
    labelStatus: dict[str, str] = Field(default_factory=dict)


class MaskExportResponse(BaseModel):
    saved: list[str]
    errors: list[dict[str, str]] = Field(default_factory=list)
```

- [ ] **Step 4: 加端点** — `backend/app/api/images.py`

顶部 import 增补：

```python
from app.models.batch import Batch
from app.schemas.annotation import MaskExportRequest, MaskExportResponse
from app.services.mask_export import export_image_masks
```

文件末尾新增：

```python
@router.post("/images/{image_id}/export-mask", response_model=MaskExportResponse)
def export_mask(
    image_id: int,
    body: MaskExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    batch = db.query(Batch).filter(Batch.id == img.batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    work_dir = _get_work_dir(db)
    shapes_dicts = [
        {"id": s.id, "label": s.label, "shapeType": s.shapeType,
         "points": s.points, "holes": s.holes}
        for s in body.shapes
    ]
    result = export_image_masks(work_dir, batch, img, shapes_dicts, body.labelStatus)
    return MaskExportResponse(saved=result["saved"], errors=result["errors"])
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_images.py -q`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/schemas/annotation.py backend/app/api/images.py backend/app/tests/test_images.py
git commit -m "feat: add POST /images/{id}/export-mask endpoint"
```

---

### Task 3: 导入初始状态修正（空 mask → absent）

**Files:**
- Modify: `backend/app/services/mask_import.py`
- Test: `backend/app/tests/test_mask_import.py`

**Interfaces:**
- Consumes: 现有 `import_image_masks` / `import_batch_masks`。
- Produces: 空 mask 的标签 `label_status[label] = "absent"`；`import_batch_masks` 在仅有 absent 状态时也写 JSON。

- [ ] **Step 1: 写失败测试** — `backend/app/tests/test_mask_import.py` 末尾新增

```python
def test_import_empty_mask_marks_absent(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))
    _make_mask(tmp_work_dir, val=0)  # 全黑 mask
    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    result = import_batch_masks(tmp_work_dir, batch, db, username="test")
    assert result["imported"] == 1
    data = json.load(open(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")))
    assert data["shapes"] == []
    assert data["labelStatus"] == {"cat": "absent"}
    db.close()


def test_import_partial_labels_present_and_pending(client, tmp_work_dir):
    token = _admin_token(client)
    _make_image(tmp_work_dir)
    client.post("/api/batches/scan", headers=_auth(token))
    _make_mask(tmp_work_dir, label="cat", val=255)  # 只有 cat 有 mask
    from app.models.batch import Batch
    db = _session()
    batch = db.query(Batch).filter(Batch.name == "b1").one()
    import_batch_masks(tmp_work_dir, batch, db, username="test")
    data = json.load(open(os.path.join(tmp_work_dir, "batches", "b1", "annotations", "a.json")))
    # dog 没有 mask 文件 → 不在 labelStatus → 前端视为 pending
    assert data["labelStatus"] == {"cat": "present"}
    db.close()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import.py -q`
Expected: `test_import_empty_mask_marks_absent` FAIL（现在空 mask 不写任何状态、不写 JSON）。

- [ ] **Step 3: 空 mask → absent** — `backend/app/services/mask_import.py` 的 `import_image_masks`

把：

```python
        if not polygons:
            continue
```

改为：

```python
        if not polygons:
            # 有 mask 文件但全黑为空 → 该标签在此图 absent
            result["label_status"][label_name] = "absent"
            continue
```

- [ ] **Step 4: 仅有 absent 也写 JSON** — `backend/app/services/mask_import.py` 的 `import_batch_masks`

把：

```python
        if not r["imported"]:
            continue
```

改为：

```python
        if not r["imported"] and not r["label_status"]:
            continue
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && ../.venv/bin/pytest app/tests/test_mask_import.py -q`
Expected: PASS（含新增 2 个）。

- [ ] **Step 6: 全量后端测试**

Run: `cd backend && ../.venv/bin/pytest -q`
Expected: 全部通过（89 + 新增）。

- [ ] **Step 7: 提交**

```bash
git add backend/app/services/mask_import.py backend/app/tests/test_mask_import.py
git commit -m "fix: mark empty mask as absent and persist all-absent imports"
```

---

### Task 4: 前端 `editorStore` 标签状态自动维护 + 单键切换

**Files:**
- Modify: `frontend/src/stores/editorStore.ts`
- Test: `frontend/src/stores/editorStore.test.ts`

**Interfaces:**
- Consumes: 现有 `Shape` 类型、`LabelStatusValue`。
- Produces: `cycleLabelStatus(label: string)` 新 action；`finishDrawing`/`deleteSelectedShape`/`applyAdd`/`applyCut` 自动更新 `labelStatus`。

- [ ] **Step 1: 写失败测试** — `frontend/src/stores/editorStore.test.ts`

```ts
// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import { useEditorStore } from './editorStore';

function drawCat(): string {
  const s = useEditorStore.getState();
  s.setSelectedLabel('cat');
  s.startDrawing();
  s.addDrawingPoint(0, 0);
  s.addDrawingPoint(10, 0);
  s.addDrawingPoint(10, 10);
  s.finishDrawing();
  return useEditorStore.getState().shapes[0].id;
}

describe('label status follows content', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('drawing a shape marks the label present', () => {
    drawCat();
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
  });

  it('deleting the last shape marks the label absent', () => {
    const id = drawCat();
    useEditorStore.getState().selectShape(id);
    useEditorStore.getState().deleteSelectedShape();
    expect(useEditorStore.getState().labelStatus['cat']).toBe('absent');
  });

  it('cycleLabelStatus toggles pending and resolves by content', () => {
    const s = useEditorStore.getState();
    s.cycleLabelStatus('cat');                       // pending(no shapes) -> absent
    expect(s.labelStatus['cat']).toBe('absent');
    s.cycleLabelStatus('cat');                       // absent -> pending
    expect(s.labelStatus['cat']).toBe('pending');
    drawCat();                                       // -> present (auto)
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
    useEditorStore.getState().cycleLabelStatus('cat'); // present -> pending
    expect(useEditorStore.getState().labelStatus['cat']).toBe('pending');
    useEditorStore.getState().cycleLabelStatus('cat'); // pending -> present (has shapes)
    expect(useEditorStore.getState().labelStatus['cat']).toBe('present');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL（`cycleLabelStatus is not a function`；画图/删图不更新状态）。

- [ ] **Step 3: 实现** — `frontend/src/stores/editorStore.ts`

接口 `EditorState` 里加：

```ts
  setLabelStatus: (label: string, status: LabelStatusValue) => void;
  cycleLabelStatus: (label: string) => void;
```

实现里 `setLabelStatus` 之后加：

```ts
  cycleLabelStatus: (label) => {
    const { labelStatus, shapes } = get();
    const current = labelStatus[label] ?? 'pending';
    const hasShapes = shapes.some(s => s.label === label);
    const next: LabelStatusValue =
      current === 'pending' ? (hasShapes ? 'present' : 'absent') : 'pending';
    get().setLabelStatus(label, next);
  },
```

`finishDrawing`：在 `set({...})` 里加 `labelStatus: { ...labelStatus, [selectedLabel]: 'present' }`（在 `shapes: [...shapes, shape]` 之后）。

`deleteSelectedShape`：改为先取被删 shape 的 label、计算剩余：

```ts
  deleteSelectedShape: () => {
    const { selectedShapeId, shapes, labelStatus } = get();
    if (!selectedShapeId) return;
    const deleted = shapes.find(s => s.id === selectedShapeId);
    if (!deleted) return;
    const label = deleted.label;
    const remaining = shapes.filter(s => s.id !== selectedShapeId);
    const newStatus: LabelStatusValue = remaining.some(s => s.label === label) ? 'present' : 'absent';
    const snapshot = cloneSnapshot(shapes, labelStatus);
    const undoStack = [...get().undoStack, snapshot].slice(-MAX_UNDO);
    set({
      shapes: remaining,
      labelStatus: { ...labelStatus, [label]: newStatus },
      selectedShapeId: null,
      undoStack, redoStack: [], isDirty: true,
    });
  },
```

`applyAdd`：在 `set({...})` 里加 `labelStatus: { ...labelStatus, [selected.label]: 'present' }`。

`applyCut`：两处 `set({...})` 都加 labelStatus：
- `result.length === 0` 分支：`const remaining = shapes.filter(s => s.id !== selectedShapeId); const newStatus = remaining.some(s => s.label === label) ? 'present' : 'absent';` 加 `labelStatus: { ...labelStatus, [label]: newStatus }`。
- 正常分支：加 `labelStatus: { ...labelStatus, [label]: 'present' }`。

（`undo`/`redo`/`loadAnnotation` 已整体恢复 `labelStatus`，无需改。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/stores/editorStore.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/stores/editorStore.ts frontend/src/stores/editorStore.test.ts
git commit -m "feat: auto-derive label status from annotation content"
```

---

### Task 5: `LabelStatusList` 单键切换

**Files:**
- Modify: `frontend/src/components/panels/LabelStatusList.tsx`

**Interfaces:**
- Consumes: Task 4 的 `cycleLabelStatus`。
- Produces: 按钮点击调用 `cycleLabelStatus`，不再本地推算 next。

- [ ] **Step 1: 实现** — 把 `setLabelStatus` 换成 `cycleLabelStatus`

import 处：`const setLabelStatus = useEditorStore(s => s.setLabelStatus);` → `const cycleLabelStatus = useEditorStore(s => s.cycleLabelStatus);`

删除本地 `cycleStatus` 函数，按钮 onClick 改为 `() => cycleLabelStatus(label.name)`。

```tsx
<button
  className={`${styles.statusBtn} ${styles[STATUS_OPTIONS.find(o => o.value === status)?.className || 'pending']}`}
  onClick={() => cycleLabelStatus(label.name)}
  title={`状态: ${status}（点击切换待定）`}
>
  {STATUS_OPTIONS.find(o => o.value === status)?.label || '?'}
</button>
```

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/panels/LabelStatusList.tsx
git commit -m "feat: single-key label status toggle (pending only)"
```

---

### Task 6: 前端导出按钮 + 待定确认弹窗

**Files:**
- Create: `frontend/src/api/masks.ts`
- Modify: `frontend/src/components/toolbar/CanvasControls.tsx`

**Interfaces:**
- Consumes: `apiClient.post`；Task 4 的 `shapes`/`labelStatus`；`useImageStore` 的 `currentImage`/`lockedByMe`。
- Produces: `exportImageMask(imageId, shapes, labelStatus)`；「保存 mask」按钮。

- [ ] **Step 1: 写 API 层** — `frontend/src/api/masks.ts`

```ts
import { apiClient } from './client';
import type { Shape, LabelStatusValue } from '../types/shapes';

export interface MaskExportResponse {
  saved: string[];
  errors: { label: string; error: string }[];
}

export async function exportImageMask(
  imageId: number,
  shapes: Shape[],
  labelStatus: Record<string, LabelStatusValue>,
): Promise<MaskExportResponse> {
  return apiClient.post<MaskExportResponse>(`/images/${imageId}/export-mask`, {
    shapes,
    labelStatus,
  });
}
```

- [ ] **Step 2: 加按钮 + 弹窗** — `frontend/src/components/toolbar/CanvasControls.tsx`

import 增补：

```ts
import { useState } from 'react';
import { useImageStore } from '../../stores/imageStore';
import { exportImageMask } from '../../api/masks';
```

组件内新增状态与逻辑（`shapeCount` 之后）：

```ts
  const currentImage = useImageStore(s => s.currentImage);
  const lockedByMe = useImageStore(s => s.lockedByMe);
  const labelStatus = useEditorStore(s => s.labelStatus);
  const shapes = useEditorStore(s => s.shapes);
  const [maskStatus, setMaskStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');

  const hasPresentOrAbsent = Object.values(labelStatus).some(v => v === 'present' || v === 'absent');
  const canExport = currentImage !== null && lockedByMe && hasPresentOrAbsent;

  async function handleExportMask() {
    if (!currentImage) return;
    const pending = Object.entries(labelStatus)
      .filter(([, v]) => v === 'pending')
      .map(([k]) => k);
    if (pending.length > 0) {
      const ok = window.confirm(`存在待定标签：${pending.join('、')}。是否忽略待定标签继续保存？`);
      if (!ok) return;
    }
    setMaskStatus('exporting');
    try {
      await exportImageMask(currentImage.id, shapes, labelStatus);
      setMaskStatus('done');
      window.setTimeout(() => setMaskStatus('idle'), 2500);
    } catch {
      setMaskStatus('error');
    }
  }
```

在 `SaveIndicator` 前插入按钮：

```tsx
      <button
        className={styles.btn}
        disabled={!canExport || maskStatus === 'exporting'}
        onClick={handleExportMask}
      >
        {maskStatus === 'exporting' ? '⏳' : maskStatus === 'done' ? '✓' : '⬇'}
        <span className={styles.tooltip}>
          {maskStatus === 'done' ? '已保存 mask' : maskStatus === 'error' ? '保存 mask 失败' : '保存 mask'}
        </span>
      </button>
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api/masks.ts frontend/src/components/toolbar/CanvasControls.tsx
git commit -m "feat: add save-mask button with pending-label confirm"
```

---

## 验证（端到端）

1. `cd backend && ../.venv/bin/pytest -q` 全绿。
2. `cd frontend && npx vitest run && npx tsc --noEmit && npx vite build` 全绿。
3. 手工：打开一张图 → 画形状 → 右侧「标签状态」自动变「存在」→ 删掉 → 变「不存在」→ 点状态切「待定」→ 画布工具栏点「保存 mask」→ 弹出待定确认 → 确认后 `batches/<batch>/masks/<标签>/<原图>.png` 生成；全黑/挖孔正确。
