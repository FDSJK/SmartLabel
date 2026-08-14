# 保存 mask（多边形 → 二值图导出）设计

> 日期：2026-08-14
> 状态：已确认方案，待实现
> 关联：[2026-08-13-mask-import-design.md](./2026-08-13-mask-import-design.md)、[2026-07-31-online-annotation-tool-design.md](./2026-07-31-online-annotation-tool-design.md)

## 1. 背景与目标

当前软件只支持「mask 二值图 → 多边形」的导入方向。用户标注完成后，需要把当前标注结果
**导出回二值 mask 图**，与导入共用同一目录约定，支持往返。

同时，本次顺带重构「标签状态」语义：现有 `labelStatus` 是纯手工三态（present/absent/pending）
手动切换，容易误操作（明明没画却标「存在」，画了却标「不存在」）。改为**由标注内容自动推导**
present/absent，「待定」作为唯一可手动打的标记。

**核心目标：**

1. 加一个「保存 mask」按钮，把**当前这张图**的标注按标签导出成二值图（每个标签一张）。
2. 标签状态跟随标注内容自动更新，杜绝误操作。
3. 保存时若存在「待定」标签，弹窗确认是否忽略。

## 2. 数据约定

### 2.1 导出目录（复用导入约定，支持往返）

```
batches/<batch>/
  masks/
    <标签名>/         ← 子目录名 = 标签名
      <原图名>.png    ← 文件名 = 原图文件名（去扩展名），二值图 0/255
```

- 每个**有保存结果的标签**一张 PNG；前景 255，背景 0。
- 与导入共用 `masks/<标签>/<原图>.png` 布局，导入导出可往返。

### 2.2 标签状态（重构）

存储结构不变：`labelStatus: {标签名: 'present' | 'absent' | 'pending'}`（sidecar JSON 的 `labelStatus` 字段）。

语义改为「内容自动推导 + 待定手动标记」：

| 状态 | 含义 | 来源 |
| --- | --- | --- |
| `present`（存在） | 该标签在这张图里有 ≥1 个形状 | 自动：画下第一个形状 |
| `absent`（不存在） | 该标签在这张图里没有形状 | 自动：删掉最后一个形状 |
| `pending`（待定） | 还没判定 / 未完成 | 手动标记 |

**状态机规则：**

- 自动推导：
  - 画下某标签的**第一个**形状 → `present`。
  - 删掉某标签的**最后一个**形状 → `absent`。
- 手动切换（右侧「标签状态」面板的按钮，单键）：
  - 当前 `present` → 点击 → `pending`。
  - 当前 `absent` → 点击 → `pending`。
  - 当前 `pending` → 点击 → 有形状则 `present`，无形状则 `absent`。
- **`present` ↔ `absent` 之间永远不能直接手动互切**——只取决于是否真有标注内容。

**初始状态（mask 导入时）：**

- 导入**无 mask** 的数据 → 所有标签初始 `pending`。
- 导入**含 mask** 的数据 → 有 mask 内容的标签 `present`，没有的 `absent`（按内容填，不留 pending）。

**边界（已确认）：** 某标签被手动标了 `pending`，之后又去画/删它的形状 → 内容一变就自动回到
`present`/`absent`。即 `pending` 只对「还没碰过的标签」持续有效。

## 3. 处理流程

### 3.1 栅格化（`mask_export.shapes_to_masks`）

输入 `shapes`、`label_status`、`width`、`height`，输出 `{标签名: uint8 二值图}`（仅含要保存的标签）。

1. 按 `label_status` 决定要保存哪些标签：
   - `present` 和 `absent` → 建一张 `np.zeros((height, width), uint8)`。
   - `pending` → 跳过。
2. **第一遍**：对每个 `present` 标签的形状，`cv2.fillPoly(mask, [外环], 255)` 填外环。
3. **第二遍**：对每个 `present` 标签的每个孔，`cv2.fillPoly(mask, [孔环], 0)` 挖孔。
   - 两遍分离，保证「孔永远压过填充」，与 shape 遍历顺序无关。
4. `absent` 标签保持全黑（空图）。

坐标从 `shape.points`/`shape.holes`（浮点像素坐标）取，`np.array(..., np.int32)` 取整；cv2 内部对越界做裁剪。

### 3.2 写文件（`mask_export.export_image_masks`）

对 `shapes_to_masks` 返回的每个标签，`PIL.Image.fromarray(mask).save(...)` 写到
`batches/<batch>/masks/<标签>/<原图名>.png`（自动建子目录），返回 `{saved: [标签名...]}`。

### 3.3 触发方式

- **单图保存**：`POST /api/images/{image_id}/export-mask`，body 传 `{shapes, labelStatus}`。
  - 前端把**当前内存中的** shapes + labelStatus 发过去（避免自动保存未落盘的竞态）。
  - 宽高从 DB 的 `Image` 取。
  - 认证用 `get_current_user`（标注者本人，不需管理员）。
  - 返回 `{saved: [标签名...]}`。
- **批次导出（本次不做，仅预留）**：将来在左侧图像列表上方加按钮，`export_batch_masks` 循环读
  每张图的 sidecar JSON → 喂给同一个 `export_image_masks`，零重复。

### 3.4 待定标签确认（前端）

点「保存 mask」时，若当前 `labelStatus` 中存在 `pending` 标签：

- 弹窗：「存在待定标签：cat、dog。是否忽略待定标签继续保存？」
  - **忽略并保存** → 跳过 pending 标签，其余照常写。
  - **取消** → 关闭弹窗、不执行保存，人工去处理待定标签。

## 4. 组件与文件变更

| 文件 | 变更 |
| --- | --- |
| `backend/app/services/mask_export.py` | 新增：`shapes_to_masks`、`export_image_masks` |
| `backend/app/api/images.py` | 新增 `POST /images/{id}/export-mask` 端点 |
| `backend/app/schemas/annotation.py`（或新增 schema） | 新增 `MaskExportRequest {shapes, labelStatus}` / `MaskExportResponse {saved}` |
| `backend/app/services/mask_import.py` | 初始 `labelStatus` 按「有/无 mask」填 present/absent/pending |
| `frontend/src/api/masks.ts` | 新增：`exportImageMask(imageId, shapes, labelStatus)` |
| `frontend/src/stores/editorStore.ts` | 画/删形状时自动更新 labelStatus；`setLabelStatus` 改为单键 pending↔内容推导 |
| `frontend/src/components/panels/LabelStatusList.tsx` | 按钮改为 pending↔(present/absent) 单键切换 |
| `frontend/src/components/toolbar/CanvasControls.tsx` | 新增「保存 mask」按钮 + 待定确认弹窗 |

## 5. 错误处理

- 写文件失败 → 该标签跳过，其余继续；响应里带上失败信息（`errors`）。
- 无形状且无 labelStatus → 无标签可保存，`saved` 为空数组，前端提示「没有可保存的标签」。

## 6. 已知限制

- 同标签多 shape 重叠时按「填所有外环、再挖所有孔」处理，不做并集运算（非重叠场景精确，
  重叠的极端场景可能不完美并集）。
- 孔的顶点不可单独编辑（继承自导入方向，见 mask-import spec §6）。

## 7. 测试

- `shapes_to_masks`：
  - 实心方形 → 白块；甜甜圈 → 孔内 0、环 255。
  - 两标签 → 两张；`absent` → 全黑；`pending` → 不出现。
- `export_image_masks`（临时 work_dir）：
  - 写入路径正确、无标注标签不写、**往返**（导出 → `vectorize_mask` → 轮廓近似还原）。
- 端点：`POST /images/{id}/export-mask` 返回 `saved`，文件落盘。
- 前端：`tsc` + build；状态机规则（画/删自动更新、pending 单键切换）在 store 层验证。
