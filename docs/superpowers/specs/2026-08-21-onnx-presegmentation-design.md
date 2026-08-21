# ONNX 预分割（第四阶段）设计文档

> 日期：2026-08-21
> 状态：设计完成，待用户审阅
> 目标分支：`feat/per-user-work-dir`（跑通后合并 `main`）

## 1. 背景与目标

第四阶段：ONNX 推理预分割。用户为图像触发语义分割模型推理，得到预分割草稿，在画布上**直接编辑**草稿，接受后转为正式标注，随后走既有的「保存 / 保存为 mask / 批量导出」流程。

目标：

- 支持多类别语义分割模型，输出统一为 **N+1 通道**（N 个标签 + 1 个背景），`argmax` 与 `sigmoid` 两种后处理均兼容
- 单图 + 整批两种触发方式，共用一套 `inference_jobs` 队列
- 模型文件支持**网页上传**与**服务器路径**两种来源
- **CPU / GPU 均兼容**（自动检测 NVIDIA GPU 走 CUDA，无 GPU 回退 CPU）
- 草稿持久化为 JSON，打开图像自动加载、可直接编辑，接受/拒绝后落盘或删除
- 全程复用既有能力：`vectorize_mask`（含孔洞）、保存/导出、编辑锁、按用户隔离

## 2. 关键决策汇总

| 主题 | 决定 |
|------|------|
| 输出通道 | 统一 N+1（N 标签 + 1 背景），**背景通道位置可配**（`background_channel`，默认 0） |
| 输出语义 | 模型输出 logits；后处理再套 softmax（argmax 模式）/ sigmoid（sigmoid 模式） |
| 后处理模式 | `argmax` / `sigmoid` 可配，两模式共用同一「标签名 → 通道索引」映射 |
| sigmoid 阈值 | 可配，默认 0.5 |
| 输入尺寸 | 固定、可配（`input_w` / `input_h`） |
| resize 方式 | `stretch`（直接拉伸，默认）/ `letterbox`（等比补边），可配；插值 INTER_CUBIC |
| 归一化 | `normalize_mode` 可配：`min_max`（默认，逐通道逐图）/ `mean_std` / `none` |
| 通道顺序 | RGB |
| 预处理实现 | 配置驱动（方案 A），后端一个通用 `preprocess()`，顺序：resize → 归一化 |
| 触发粒度 | 单图 + 整批，共用 `inference_jobs` |
| 模型文件来源 | `upload`（网页上传存服务器 `models/`）与 `path`（服务器绝对路径）都支持 |
| 设备 | 自动检测 CUDA EP，无 GPU 回退 CPU |
| 草稿处理 | 折中方案：草稿层 + 接受/拒绝门槛，但 DraftLayer **直接可编辑** |
| 草稿持久化 | 存独立草稿 JSON，打开图自动加载 |

## 3. 模型 I/O 契约

> 对齐用户实际推理代码 `test_UWF.py`（TransUNet R50-ViT-B_16，img_size=512）。

### 3.1 输出

- 模型输出张量形状 `(1, C, H', W')`，其中 `C = N + 1`，为**未归一化的 logits**。
- `background_channel`（默认 **0**）：该通道像素判为背景（无标签）。
- 其余 N 个通道由 `categories` 里的 `标签名 → channel` 映射决定（用户模型：背景=0，标签从 1 开始）。
- 后处理：
  - **argmax**：对 logits 逐像素取最大类别（等价 softmax+argmax）；落在背景通道的像素 = 无标签（不生成 shape）。
  - **sigmoid**：对每个标签通道 `sigmoid(logit) > threshold` 二值化；背景通道仅在「所有标签通道都低于阈值」时兜底判为背景。多标签允许像素同属多个类别。

### 3.2 输入

- 固定尺寸 `input_w × input_h`（配置项，用户模型 512×512）。
- `resize_mode`：
  - `stretch`（默认）：直接 `cv2.resize` 到 `input_w × input_h`，插值 INTER_CUBIC（不保形变，对齐用户代码）。
  - `letterbox`：等比缩放后补边（填充色 0）。
- 归一化（`normalize_mode`）：
  - `min_max`（默认，对齐用户代码）：resize 后逐通道逐图 `(x - min)/(max - min)`，min/max 对当前图像在 H、W 上按通道分别计算。
  - `mean_std`：`(x/255 - mean)/std`，mean/std 为 `[r,g,b]` JSON（默认 ImageNet）。
  - `none`：仅转 float32，不做归一化。
- 通道顺序 RGB（`PIL.open(...).convert('RGB')` → ndarray → CHW）。
- **预处理顺序**：`resize → 归一化`（先 resize 再归一化，与用户代码一致）。

## 4. 数据模型

### 4.1 `model_configs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int PK | |
| name | str unique | 模型名称 |
| source | str | `upload` / `path` |
| model_path | str | upload = 服务器 `models/` 下文件名；path = 服务器绝对路径 |
| input_width | int | 固定输入宽 |
| input_height | int | 固定输入高 |
| resize_mode | str | `stretch`（默认）/ `letterbox` |
| normalize_mode | str | `min_max`（默认）/ `mean_std` / `none` |
| mean | JSON `[r,g,b]` nullable | 仅 `mean_std` 使用 |
| std | JSON `[r,g,b]` nullable | 仅 `mean_std` 使用 |
| background_channel | int | 背景通道索引，默认 0 |
| categories | JSON | `[{"label": "肿瘤", "channel": 1}, ...]`；显式标通道索引 |
| postprocess | str | `argmax` / `sigmoid` |
| sigmoid_threshold | float | 默认 0.5，仅 sigmoid 使用 |
| enabled | bool | 启用开关 |
| created_at / updated_at | datetime | |

### 4.2 `inference_jobs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int PK | |
| image_id | FK images.id | 目标图像 |
| model_config_id | FK model_configs.id | 使用的模型 |
| requested_by | FK users.id | 触发人 |
| scope | str | `single` / `batch` |
| status | str | `queued` / `running` / `done` / `failed` |
| error | str nullable | 失败原因 |
| created_at / finished_at | datetime | |

> 批推理 = 为批次内每张图各建一条 `scope="batch"` 的 job，不做单独的「批次任务」父记录（v1）。

### 4.3 草稿 JSON

存放于 `batches/<batch>/drafts/<图像文件名>.json`（与 `annotations/` 平级，随批次可拷贝迁移；扫描与导出忽略 `drafts/` 子目录，同 `cache/`）。

```json
{
  "imageName": "img-001.png",
  "modelConfigId": 3,
  "modelName": "unet-v2",
  "createdAt": "2026-08-21T15:30:00+08:00",
  "shapes": [
    { "id": "uuid", "label": "肿瘤", "shapeType": "polygon",
      "points": [[120, 80], [180, 90], [200, 160], [130, 170]],
      "holes": [] }
  ]
}
```

- 草稿 shape 与正式 shape 同构（含 `holes`，矢量化保留孔洞）。
- 每个图像**同一时刻仅一份草稿**（新推理覆盖旧草稿；若有未保存编辑，前端提示确认）。

## 5. 推理流水线（`onnx_service`）

```
原始图 (W,H,RGB)
 → resize 到 (input_w,input_h)：stretch(INTER_CUBIC) / letterbox
 → 归一化：min_max / mean_std / none（先 resize 后归一化）
 → (1,3,H,W) float32 → onnx 推理（CUDA 优先，无 GPU 回退 CPU）
 → 输出 logits (1, N+1, H', W')
 → 后处理：
    argmax:  逐像素 argmax → 类 id 图（background_channel→背景）→ 最近邻上采样到输入尺寸
    sigmoid: sigmoid(logit) 概率 → 双线性上采样到输入尺寸 → 逐通道阈值二值化
 → 逆 resize：stretch 直接逆缩放回 (W,H)；letterbox 先裁剪补边再逆缩放
 → 逐标签得到原图分辨率的二值 mask
 → 复用 vectorize_mask（提取内外轮廓，含孔洞）→ 每个标签的 polygons
 → 组装草稿 shapes → 写入草稿 JSON
```

关键点：

- **坐标映射**：推理 mask 在输入坐标系，必须**逆变换回原图坐标**，shape 才能和画布原图对齐。注意 width/height 语义（PIL 是 (w,h)，ndarray 是 (h,w)），避免坐标转置。
- **矢量化复用**：把 `mask_import.vectorize_mask` 的核心抽成接收 ndarray 的 `vectorize_array(arr)`（原 `vectorize_mask(path)` 调它），避免重复实现。
- **模型加载**：懒加载 ONNX session，按 `model_config_id` 缓存；配置变更/删除时失效重载。
- **串行化**：v1 用 FastAPI `BackgroundTasks` + 一把进程内锁串行执行推理（CPU 场景防过载）。

## 6. 后端 API

### 模型配置

| 方法 | 端点 | 说明 | 角色 |
|------|------|------|------|
| GET | `/api/models` | 模型列表 | 登录可读 |
| POST | `/api/models` | 新建模型配置 | admin |
| PUT | `/api/models/:id` | 更新模型配置 | admin |
| DELETE | `/api/models/:id` | 删除模型配置 | admin |
| POST | `/api/models/upload` | 上传 .onnx 到服务器 `models/`，返回存储文件名 | admin |

### 推理

| 方法 | 端点 | 说明 | 角色 |
|------|------|------|------|
| POST | `/api/models/:id/inference/:image_id` | 单图推理，返回 `{ jobId }` | annotator |
| POST | `/api/models/:id/inference/batch/:batch_id` | 整批推理，返回 `{ queued, jobIds }` | annotator |
| GET | `/api/inference-jobs/:id` | 查询任务状态 | annotator |
| GET | `/api/inference-jobs?image_id=&batch_id=` | 按图像/批次列任务 | annotator |

### 草稿

| 方法 | 端点 | 说明 | 角色 |
|------|------|------|------|
| GET | `/api/images/:id/draft` | 读草稿（无则 404） | annotator |
| PUT | `/api/images/:id/draft` | 保存草稿编辑（body：`{shapes}`） | annotator |
| POST | `/api/images/:id/draft/accept` | 接受：草稿 shapes 并入标注，删草稿 | annotator |
| DELETE | `/api/images/:id/draft` | 拒绝：删草稿 | annotator |

> 权限：所有草稿/推理端点走 `get_owned_image` / `get_owned_batch`（按用户隔离）；`accept` 写入标注，需遵循与保存相同的编辑锁 + 版本校验（冲突返回 409）。

## 7. 前端设计

### 7.1 画布分层

```
<Layer> ImageLayer </Layer>       底层：原图
<Layer> MaskLayer </Layer>        已确认 shapes（标签色，render-only）
<Layer> DraftLayer </Layer>       预分割草稿（蓝色，render-only）
<Layer> DrawingLayer </Layer>     顶层：统一交互 + 绘制预览 + 选中手柄
```

- **DraftLayer** 与 MaskLayer 同构，`<Path fillRule="evenodd">` 渲染 `draftStore.draftShapes`，蓝色半透明、`listening={false}`，受 `uiStore.showDraft` 控制。
- **DrawingLayer** 仍是唯一交互层，扩展成同时命中并编辑「草稿」与「已确认」两类 shape。

### 7.2 新增文件

| 类型 | 文件 |
|------|------|
| store | `stores/draftStore.ts` |
| canvas | `components/canvas/DraftLayer.tsx` |
| panel | `components/panels/InferencePanel.tsx` |
| page | `pages/AdminModelsPage.tsx` |
| api | `api/models.ts`、`api/inference.ts`、`api/draft.ts` |
| hook | `hooks/useDraftAutoSave.ts` |
| 改动 | `KonvaStage.tsx`（插 DraftLayer）、`DrawingLayer.tsx`（草稿命中/路由）、`imageStore.ts`（切图加载/卸载草稿）、`App.tsx`（路由 `/admin/models`）、`RightPanel.tsx`（嵌 InferencePanel）、`uiStore.ts`（修 showDraft 语义） |

### 7.3 `draftStore`

独立于 `editorStore`，草稿有自己的生命周期，不污染已确认标注的 undo/redo 与 labelStatus：

```ts
interface DraftState {
  draftShapes: Shape[];
  draftMeta: { modelConfigId: number; modelName: string; createdAt: string } | null;
  selectedDraftId: string | null;
  isDirty: boolean;
  status: 'none' | 'loading' | 'ready';

  loadDraft(imageId): Promise<void>;
  selectDraft(id): void;                 // 互斥：清掉 editorStore.selectedShapeId
  moveDraftShape(id, points, holes?): void;
  moveDraftVertex(id, vertexIndex, x, y): void;
  deleteDraftShape(id): void;
  acceptDraft(imageId): Promise<void>;
  rejectDraft(imageId): Promise<void>;
  markDraftSaved(): void;
  clear(): void;
}
```

- 草稿编辑**不改 labelStatus、不进 undo/redo**（草稿临时，不满意直接「拒绝」重新推理）。
- 选中态互斥：`selectDraft` 与 `editorStore.selectShape` 互相清空对方。

### 7.4 草稿编辑交互（单交互层 + 选中路由）

DrawingLayer 在 select 模式命中顺序改为：

```
先 draftShapes（渲染在上层）→ 再 editorStore.shapes
  ├─ 命中草稿   → draftStore.selectDraft(id)，拖动/顶点/删除 路由到 draftStore
  └─ 命中已确认 → editorStore.selectShape(id)，走现有逻辑（含 undo/redo）
```

- `findNearestVertex` / `findNearestShape` / `isPointInShape` 已按 shape 列表参数化，直接复用。
- 选中草稿的高亮、顶点手柄、删除按钮由 DrawingLayer 渲染，**蓝色**强调色区分。
- Delete/Backspace：草稿选中删草稿、已确认选中删已确认，按 `selectedDraftId` / `selectedShapeId` 分流。

### 7.5 草稿生命周期

```
打开图 → imageStore.loadImage 成功后 draftStore.loadDraft(imageId)
        → 有草稿 status=ready，DraftLayer 显示；无草稿 status=none
切图/清图 → draftStore.clear()

编辑草稿 → isDirty=true → useDraftAutoSave（300ms 防抖，PUT /api/images/:id/draft）
接受 → POST accept → 后端草稿转正写入 annotations + 删草稿 JSON
      → 前端重拉标注（editorStore.loadAnnotation）+ draftStore.clear()
拒绝 → DELETE draft → draftStore.clear()
```

`useDraftAutoSave` 镜像现有 `useAutoSave`（订阅 `isDirty`、防抖、`lockedByMe` 时才写、错误状态）。

### 7.6 InferencePanel（右栏）

- 模型下拉（只列 `enabled`，`GET /api/models`）
- 「推理此图」→ `POST /api/models/:id/inference/:image_id`，轮询 `GET /api/inference-jobs/:id`
- 「推理整批」→ `POST /api/models/:id/inference/batch/:batch_id`，提示「已排队 N 张」
- 状态行：idle / queued / running / done / failed（显示 error + 重试）
- 当前图 job 完成 → 自动 `draftStore.loadDraft`，草稿上屏

> 整批逐图进度徽标（ImageList 角标）留作增强项，v1 仅触发后后台排队、打开图时自动加载已完成草稿。

### 7.7 AdminModelsPage（`/admin/models`，仅 admin）

- 列表：名称 / source / 输入尺寸 / 后处理模式 / 启用开关。
- 表单：name、source（upload 文件选择 ↔ path 文本框）、input_w/input_h、resize_mode、normalize_mode（min_max/mean_std/none，选 mean_std 时展开 mean/std）、background_channel、categories 动态行 `[标签下拉 + channel]`、postprocess + sigmoid_threshold、enabled。
- 导航：admin 侧栏加「模型配置」入口。

### 7.8 顺带修正

`uiStore.showDraft` 当前被 DrawingLayer 误用作「绘图开关」（`drawingActive = ... && showDraft`）。本次归还语义：`showDraft` 只控制 DraftLayer 显隐；绘图开关改为依赖 `showMask` 或单独判断。

## 8. 测试策略

### 后端

- `onnx_service` 预处理/后处理单测：
  - min_max / mean_std / none 三种归一化
  - argmax 后处理（含背景通道忽略）
  - sigmoid 后处理（含阈值、背景兜底）
  - stretch/letterbox 的逆坐标映射（构造已知缩放比的图像，断言多边形坐标回到原图）
- `vectorize_array` 环形 mask 保留孔洞（复用现有 `test_vectorize_mask` 思路）
- 模型配置 CRUD + 上传（mock 存储目录）
- 推理任务状态机（mock onnx session，断言 queued→done/failed、错误落库）
- 草稿读写 / 接受 / 拒绝（含合并到已有标注、409 冲突、404）
- 按用户隔离：annotator 只能对自己名下的 image/batch 触发推理、读写草稿

### 前端

- `draftStore` 选中互斥、编辑、accept/reject
- `useDraftAutoSave` 防抖与错误态
- `InferencePanel` 轮询状态流转
- `DraftLayer` 渲染 + DrawingLayer 草稿命中/路由（Vitest + RTL）

## 9. 已知限制与暂缓

- 每个图像同一时刻仅一份草稿（多模型草稿并存暂缓）。
- 整批推理逐图进度徽标暂缓。
- 草稿编辑无 undo/redo（拒绝+重推理替代）。
- 孔顶点单独编辑、极端嵌套轮廓（RETR_CCOMP 两层）沿用 mask 导入的既有限制。
- GPU（`onnxruntime-gpu`）作为可选依赖，与 CPU 包并存，检测失败自动回退。

## 10. 待用户确认的点

1. **接受后 labelStatus**：已确认取 **`present`**（接受 → 对应标签置 present，与手动绘制一致）。
2. **草稿位置**：`batches/<batch>/drafts/<image>.json`（已确认 OK）。
3. **归一化**：按你的 `test_UWF.py` 定为 **min-max 逐通道逐图**（默认），并保留 `mean_std` / `none` 可配。
