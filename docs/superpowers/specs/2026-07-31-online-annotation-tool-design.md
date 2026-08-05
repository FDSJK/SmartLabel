# 在线分割标注工具设计文档

> 日期：2026-08-05
> 状态：设计完成，等待用户审阅

## 1. 背景与目标

本产品是一个面向小团队的在线分割标注工具，采用前后端分离架构。用户通过浏览器完成图像导入、mask 标注、标签管理、批次管理、数据统计、ONNX 预分割和结果导出。

目标：

- 支持多人同时使用，能够区分标注记录归属人
- 以工作目录为数据源，标注文件实时保存到本地目录，方便整批拷贝和迁移
- 提供多边形 mask 标注、增加/裁剪编辑、防漏标确认、统计分析和多格式导出
- 代码可维护，前后端模块边界清晰，具备自动化测试

## 2. 关键决策

| 主题 | 决定 |
| --- | --- |
| 使用形态 | 小团队多人，轻量账号（admin / annotator），预留正式权限升级 |
| 数据源 | 工作目录 + SQLite 元数据索引 |
| 批次来源 | 文件夹扫描和网页上传都支持 |
| 并发控制 | 编辑锁：主动释放 + 60s 心跳续命 + 30min 超时兜底 |
| 版本控制 | `images.annotation_rev` 与 sidecar JSON `version` 镜像同步，保存时乐观锁校验 |
| 阳性/阴性统计 | 图像级统计，未标注单独展示 |
| ONNX 推理 | 后端推理，CPU 保底，检测到 NVIDIA GPU 时自动启用 CUDA |
| 模型配置 | 每类别一个模型，同时支持一个模型输出多个类别 |
| 标注存储 | 每张图一个 sidecar JSON，实时自动保存到工作目录 |
| 目录结构 | `batches/<batch>/{images,annotations,masks}`，导出统一写入 `export/` |
| Mask 规范 | PNG，8-bit 单通道，背景 0，前景 255 |
| 防漏标 | 每张图每个标签有 present / absent / pending 三种状态 |
| 协作策略 | 任务队列型 REST 架构，同一张图同一时间仅一人编辑，预留 WebSocket 升级空间 |
| 撤销策略 | 全量快照（shapes + labelStatus），绘制中支持逐顶点撤销 + Esc 整条取消 |

## 3. 功能需求

### 3.1 账号与权限

- 管理员创建、禁用账号，标注员只能登录使用
- 角色分为 `admin` 和 `annotator`
- 管理员负责：工作目录配置、用户管理、标签管理、模型配置
- 标注员可以：查看批次与图像、标注、确认标签、查看统计、触发预分割、导出
- 登录使用用户名 + 密码，密码以 bcrypt 哈希形式存储
- 认证使用 JWT token

### 3.2 工作目录与批次

- 管理员在设置中指定一个工作目录作为数据根目录
- 批次目录统一放在 `batches/` 下，一个批次一个文件夹
- 文件夹扫描：应用扫描 `batches/*/images/`，注册新增图像
- 网页上传：在界面创建批次并上传图片，后端写入 `batches/<batch>/images/`
- 批次信息包含：批次名、来源（scan / upload）、导入时间、创建人、备注
- 批量显示每张图的导入时间、是否完成标注、当前锁归属

### 3.3 图像导入

- 支持 `png`、`jpg`、`jpeg`、`tif`、`tiff`
- RGB 图像直接使用原图
- 大于三通道的图像自动转换为 RGB 工作副本，存放于 `batches/<batch>/cache/rgb/`，原图保留不变
- 图像注册时记录宽高、通道数、相对路径、批次
- 扫描时检测已有 sidecar JSON，导入已有标注并恢复统计状态
- 不支持或损坏的图像记录错误信息，不中断整批扫描

### 3.4 标注编辑器

#### 布局

- 中间为大画布，左侧为批次/图像列表，右侧为标签与状态面板，顶部为工具条
- 底部为保存状态指示器

#### 画布分层模型

画布采用四层 Konva Layer 叠加，层级之间通过 Zustand store 中转，不直接通信：

```
┌─────────────────────────────┐
│  DrawingLayer   顶部操作层   │  ← 正在画但未闭合的折线、顶点拖拽手柄
├─────────────────────────────┤
│  DraftLayer     预分割草稿层 │  ← ONNX 推理结果（半透明蓝色），接受后移入 shapes
├─────────────────────────────┤
│  MaskLayer      已确认标注层  │  ← editorStore.shapes 的渲染，已保存的 mask
├─────────────────────────────┤
│  ImageLayer     原始图像层   │  ← 底层，展示原图
└─────────────────────────────┘
```

每个层都是 editorStore / imageStore 的观察者，只响应自己关心的状态变化，层之间不直接调用。

协作规则：
- **DrawingLayer**：用户正在绘制或编辑的多边形（折线、顶点手柄），操作完成（闭合/放手）后把数据写入 editorStore，自身清空
- **DraftLayer**：渲染 ONNX 推理返回的预分割 mask；用户点「接受」→ shape 推入 editorStore.shapes；点「拒绝」→ 直接丢弃。DraftLayer 不做编辑功能，编辑统一走 DrawingLayer
- **MaskLayer**：渲染 editorStore.shapes 中所有已确认的 shape，每个标签用对应颜色填充；不关心数据来源（手动绘制、预分割接受、导入恢复），只负责渲染

#### 绘图与编辑

两种绘制工具产出相同数据格式（polygon points 数组），区别在于顶点的来源方式：

**多边形工具（单击布点）**

```
单击 → 点1    单击 → 点2    单击 → 点3    右键 → 闭合
  ●              ●━━●         ●━━●        ●━━●
                                  ┃          ┃  ┃
                                  ●          ●━━●
```

- 左键**单击**放顶点，移动鼠标显示预览线
- 右键闭合：首尾相连生成闭合多边形，push 到 editorStore.shapes
- 正在绘制但未闭合时：Ctrl+Z 逐顶点撤销，Esc 整条取消

**自由画笔工具（拖拽画线）**

```
按住左键拖动                松开左键                 右键
～～～～～～～～～～    →    曲线停在原位（未闭合）   →    首尾相连闭合
  轨迹实时采样               采样点已暂存                 push 到 editorStore.shapes
```

- 左键**按住拖动**：跟随鼠标轨迹画连续曲线，间隔采样（默认每 5px 采一个点）
- **松开左键**：曲线暂存为未闭合折线，停留在 DrawingLayer 上，不自动闭合
- **右键**：首尾相连闭合，推入 editorStore.shapes
- 松开后未闭合时：Ctrl+Z 撤销整段未闭合曲线，Esc 取消并清空

- 编辑模式：
  - 多边形工具（默认）：单击布点，右键闭合
  - 自由画笔工具：按住拖动轨迹采样，松开暂存未闭合曲线，右键闭合
  - 增加模式（默认）：新标注与现有 mask 取并集
  - 裁剪模式：新多边形从现有 mask 中减去重叠区域
  - 选择/编辑：移动顶点、增加/删除顶点、整体拖动 mask
  - 删除当前选中的 mask
- 撤销/重做：基于全量快照（shapes + labelStatus），每次操作后拍快照压入 undo 栈；绘制中逐顶点撤销（Ctrl+Z 退一个顶点），闭合后 Ctrl+Z 撤销整个 shape；Ctrl+Shift+Z 重做
- 缩放/平移：滚轮缩放，拖拽平移，支持适应窗口
- 快捷键：

| 快捷键 | 功能 |
| --- | --- |
| Ctrl/Cmd + S | 立即保存 |
| Ctrl/Cmd + Z | 撤销（绘制中退顶点，否则撤销操作） |
| Ctrl/Cmd + Shift + Z | 重做 |
| 数字键 1-9 | 切换标签 |
| 右键 | 闭合多边形 |
| Esc | 取消当前绘制的折线 |
| Delete | 删除选中 shape |

#### 标签管理

- 支持从 txt 文件导入预置标签，格式为每行 `标签名,#颜色值`，例如：

  ```
  肿瘤,#ff0000
  血管,#00cc00
  结节,#3388ff
  未命名类别
  ```

- 带颜色则使用指定颜色；不带颜色自动从内置调色板分配（保证不同标签颜色区分度）
- 前端标签列表每项显示颜色圆点，点击弹出 color picker 面板可编辑颜色
- 支持新建标签、删除标签
- `__ignore__` 和 `_background_` 为系统保留标签名

#### 标注结果展示

- 标注结果（MaskLayer）实时叠加显示在原始图像上，有显示/隐藏按钮可切换
- 预分割草稿（DraftLayer）同样支持显示/隐藏切换
- 已有标注可导入并恢复展示

### 3.5 防漏标确认

- 每张图上每个启用的标签有三种状态：
  - `present`：确认该标签存在并已标注
  - `absent`：确认该标签不存在
  - `pending`：尚未确认
- 编辑器右侧面板为每个标签显示状态标识（绿勾/红叉/灰点）
- 所有标签均为 present 或 absent 时，图像自动标记为已完成
- 已有 shapes 的标签自动视为 present，但用户仍可显式确认为 absent（会清除该标签对应的 shapes）

### 3.6 实时保存

- 每次多边形增删改或标签确认后触发自动保存，约 300ms 防抖
- 工具条提供「保存」按钮，快捷键 Ctrl/Cmd+S 立即保存
- 后端以原子写方式写入 sidecar JSON（先写临时文件，再 os.replace 替换）
- 每次保存递增 `version`
- 断网时保留浏览器草稿并显示「未保存」，恢复连接后自动重试
- 保存状态指示器状态：已保存 / 保存中… / 未保存（红） / 离线

### 3.7 统计面板

- 支持按批次和全局查看
- 对每个标签统计：
  - 阳性：已确认 present 的图像数
  - 阴性：已确认 absent 的图像数
  - 未确认：pending 的图像数
  - 总图像数、已完成数、完成率
- 统计每位标注员的已保存图像数
- 显示「最需要补充数据」的标签：按阳性数最少或阳性/阴性比最低排序
- 扫描、保存、确认标签后统计实时更新

### 3.8 ONNX 预分割

#### 模型配置

- 管理员配置模型：
  - 模型名称
  - 模型文件路径
  - 输入尺寸
  - 类别映射：标签名 → 输出索引或输出名；单类别模型可使用默认输出
  - 是否启用

#### 推理流程

- 推理在 FastAPI 后端执行，使用 ONNX Runtime
- 优先尝试 CUDA Execution Provider，不可用时回退 CPU
- 推理任务写入 `inference_jobs`，前端轮询状态
- 推理结果按类别生成 mask，转换为 DraftLayer 中的半透明草稿

#### 草稿处理

- 用户查看草稿后：
  - 接受全部 → 所有草稿 shapes 移入 editorStore.shapes，DraftLayer 清空
  - 接受此类别 → 指定标签的草稿 shape 移入 editorStore.shapes
  - 拒绝 → 直接丢弃
- 接受后的 shape 与手动标注无区别，可使用所有编辑工具继续修改
- 标签状态在接受后仍为 pending，直到用户显式确认
- 推理失败时任务记录错误信息，前端显示失败原因并允许重试

### 3.9 导出

- 导出范围：当前图像、当前批次、全部批次
- 导出格式：
  - labelme 风格 JSON
  - PNG 二值 mask
  - COCO 格式（使用 Polygon 格式，直接将 shapes 顶点坐标拍平输出）
- 二值 mask 规则：
  - 每张图每个标签生成一个 PNG
  - 标签为 present 时，由多边形栅格化生成 0/255 mask
  - 标签为 absent 时，生成全 0 的空白 mask
  - pending 标签不生成 mask，导出前提示
- 导出结果写入 `export/<时间戳>-<范围名>/`，包含 `coco/`、`labelme/`、`masks/` 子目录
- 存在未确认标签时，导出前列出警告并要求用户显式确认

#### COCO 导出格式约定

- `segmentation` 使用 Polygon 格式：`[[x1, y1, x2, y2, ...]]`，扁平化顶点坐标
- 如一个标签有多个分离区域，外层数组包含多个多边形：`[[poly1], [poly2]]`
- 由 shapes 顶点直接生成，不做额外栅格化再 RLE 转换
- 同时计算 area 和 bbox

## 4. 目录结构

```text
<工作目录>/
  batches/
    batch-20260731/
      images/
        img-001.png
      annotations/
        img-001.json
      masks/
        img-001__label-a.png
      cache/
        rgb/
          img-001_rgb.png
  export/
    20260731-153000-batch-20260731/
      coco/
        annotations.json
      labelme/
        img-001.json
      masks/
        img-001__label-a.png
```

说明：

- `masks/` 是当前工作 mask，保存标注后自动更新
- `cache/` 是可重建的中间产物，不参与统计
- `export/` 是手动导出的快照，不再随后续修改变化

## 5. 技术架构

### 5.1 总体结构

```text
backend/
  app/
    main.py
    api/
      auth.py
      users.py
      batches.py
      images.py
      annotations.py
      labels.py
      stats.py
      models.py
      inference.py
      export.py
    core/
      config.py
      db.py
      security.py
    models/          # SQLAlchemy 数据表
    schemas/         # Pydantic 请求/响应
    services/
      scanner.py
      annotation_store.py
      mask_renderer.py
      stats_service.py
      onnx_service.py
      exporter/
        __init__.py
        labelme_exporter.py
        mask_exporter.py
        coco_exporter.py
    tests/
  pyproject.toml
frontend/
  src/
    api/             # fetch 封装，与后端端点一一对应
    components/
      canvas/
        KonvaStage.tsx
        ImageLayer.tsx
        MaskLayer.tsx
        DraftLayer.tsx
        DrawingLayer.tsx
      panels/
        LeftPanel.tsx
        BatchSelector.tsx
        ImageList.tsx
        RightPanel.tsx
        LabelStatusList.tsx
        ShapeList.tsx
        InferencePanel.tsx
      toolbar/
        TopToolbar.tsx
        SaveIndicator.tsx
      common/
        ColorPicker.tsx
        ConfirmDialog.tsx
    pages/
      LoginPage.tsx
      AnnotationPage.tsx
      StatsPage.tsx
      AdminUsersPage.tsx
      AdminLabelsPage.tsx
      AdminModelsPage.tsx
      AdminSettingsPage.tsx
    stores/
      authStore.ts
      editorStore.ts
      imageStore.ts
      batchStore.ts
      labelStore.ts
      uiStore.ts
    types/
      shapes.ts
      labels.ts
      api.ts
    utils/
      debounce.ts
      color-palette.ts
      geometry.ts
    App.tsx
    main.tsx
  package.json
docs/
  superpowers/
    specs/
    plans/
```

### 5.2 后端

- FastAPI + SQLAlchemy + SQLite
- Pydantic 做请求/响应校验
- ONNX Runtime 做推理
- Pillow / NumPy 做图像转换、mask 栅格化、COCO 导出
- 第一版推理使用 FastAPI BackgroundTasks 执行，推理函数封装在 `onnx_service.py` 中，后续可替换为独立 worker

### 5.3 前端

- React + TypeScript + Vite
- Konva / react-konva 管理标注画布
- Zustand 管理编辑器状态
- 使用 CSS Modules 保持样式隔离

### 5.4 前端页面路由

| 路由 | 页面 | 组件 | 角色 |
| --- | --- | --- | --- |
| `/login` | 登录页 | LoginPage | 公开 |
| `/` | 标注编辑器（主页） | AnnotationPage | annotator |
| `/stats` | 统计面板 | StatsPage | 登录可读 |
| `/admin/users` | 用户管理 | AdminUsersPage | admin |
| `/admin/labels` | 标签管理 | AdminLabelsPage | admin |
| `/admin/models` | 模型配置 | AdminModelsPage | admin |
| `/admin/settings` | 工作目录等设置 | AdminSettingsPage | admin |

### 5.5 Zustand Store 设计

| Store | 关键状态 | 说明 |
| --- | --- | --- |
| `authStore` | `user, token, isAuthenticated, login(), logout()` | 认证状态 |
| `editorStore` | `tool, selectedLabel, shapes, labelStatus, undoStack, redoStack, isDrawing` | 编辑器核心状态，含撤销/重做栈 |
| `imageStore` | `currentImage, imageList, annotationRev, loadImage(), lock/heartbeat/unlock` | 当前编辑图像及锁管理 |
| `batchStore` | `batches, currentBatch, fetchBatches()` | 批次数据 |
| `labelStore` | `labels, fetchLabels(), addLabel(), removeLabel()` | 标签定义 |
| `uiStore` | `showMask, showDraft, zoom, pan, saveStatus` | UI 展示状态 |

### 5.6 REST API 设计

#### 认证

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 用户名密码登录，返回 JWT | 公开 |
| POST | `/api/auth/register` | 注册新标注员账号 | 公开 |

#### 用户管理

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/users` | 获取用户列表 | admin |
| POST | `/api/users` | 创建用户 | admin |
| PUT | `/api/users/:id` | 更新用户（禁用/启用/改密码） | admin |

#### 标签管理

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/labels` | 获取标签列表 | 登录可读 |
| POST | `/api/labels` | 新建标签 | admin |
| PUT | `/api/labels/:id` | 更新标签（名称/颜色） | admin |
| DELETE | `/api/labels/:id` | 删除标签 | admin |
| POST | `/api/labels/import-txt` | 从 txt 文本导入标签 | admin |

#### 批次管理

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/batches` | 获取批次列表 | 登录可读 |
| POST | `/api/batches` | 创建批次（upload 来源） | admin |
| POST | `/api/batches/scan` | 触发扫描 `batches/*/images/` | admin |
| POST | `/api/batches/:id/upload` | 上传图片到指定批次 | admin |

#### 图像

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/batches/:id/images` | 获取批次下图像列表 | 登录可读 |
| GET | `/api/images/:id` | 获取图像详情（含 annotation_rev） | 登录可读 |

#### 编辑锁

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| POST | `/api/images/:id/lock` | 获取编辑锁 | annotator |
| POST | `/api/images/:id/heartbeat` | 心跳续期（60s 间隔） | annotator |
| DELETE | `/api/images/:id/lock` | 主动释放锁 | annotator |

#### 标注

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/images/:id/annotation` | 获取标注 JSON 内容 | annotator |
| PUT | `/api/images/:id/annotation` | 保存标注（带 expectedRev） | annotator |

**PUT annotation 请求体：**

```json
{
  "expectedRev": 3,
  "shapes": [
    {
      "id": "a1b2c3",
      "label": "肿瘤",
      "shapeType": "polygon",
      "points": [[120, 80], [180, 90], [200, 160], [130, 170]]
    }
  ],
  "labelStatus": {
    "肿瘤": "present",
    "血管": "absent"
  }
}
```

**响应（成功，200）：**

```json
{
  "rev": 4,
  "savedAt": "2026-08-05T15:30:00+08:00"
}
```

**响应（冲突，409）：**

```json
{
  "error": "version_conflict",
  "message": "该图像已被其他用户修改，请重新加载",
  "currentRev": 5
}
```

#### 统计

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/stats?batch_id=&global=true` | 获取统计数据 | 登录可读 |

#### 模型配置

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/models` | 获取模型列表 | 登录可读 |
| POST | `/api/models` | 新增模型配置 | admin |
| PUT | `/api/models/:id` | 更新模型配置 | admin |
| DELETE | `/api/models/:id` | 删除模型配置 | admin |

#### 推理

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| POST | `/api/models/:id/inference/:image_id` | 触发推理（目标图像） | annotator |
| GET | `/api/inference-jobs/:id` | 查询推理任务状态 | annotator |

#### 导出

| 方法 | 端点 | 说明 | 角色 |
| --- | --- | --- | --- |
| POST | `/api/export` | 触发导出任务 | 登录可读 |

**导出请求体：**

```json
{
  "scope": "batch",
  "batchId": 1,
  "formats": ["labelme", "mask", "coco"],
  "skipUnconfirmed": false
}
```

## 6. 数据模型

### settings

- `id`
- `key`（唯一）
- `value`

用于保存工作目录、mask 规范等应用设置。

### users

- `id`
- `username`（唯一）
- `password_hash`
- `role`：`admin` / `annotator`
- `is_active`
- `created_at`

### batches

- `id`
- `name`（唯一，对应批次文件夹名）
- `source`：`scan` / `upload`
- `created_by`：外键 users.id
- `note`
- `created_at`

### images

- `id`
- `batch_id`：外键 batches.id
- `file_name`
- `src_rel_path`：批次内原图相对路径
- `work_rel_path`：多通道转换后的 RGB 工作副本相对路径，可为空
- `width`
- `height`
- `channels`
- `status`：`pending` / `in_progress` / `done`
- `locked_by`：外键 users.id，可为空
- `locked_at`：可为空
- `annotation_rev`：默认 0，用于保存冲突检测
- `created_at`
- `updated_at`

### labels

- `id`
- `name`（唯一）
- `color`
- `enabled`
- `sort_order`
- `created_at`

### image_label_status

- `id`
- `image_id`：外键 images.id
- `label_id`：外键 labels.id
- `status`：`present` / `absent` / `pending`
- `confirmed_by`：外键 users.id，可为空
- `confirmed_at`：可为空
- 唯一约束：`(image_id, label_id)`

### model_configs

- `id`
- `name`
- `model_path`
- `categories_json`：标签名到输出索引/输出名的映射
- `input_size_json`
- `enabled`
- `created_at`

### inference_jobs

- `id`
- `image_id`：外键 images.id
- `model_config_id`：外键 model_configs.id
- `requested_by`：外键 users.id
- `status`：`queued` / `running` / `done` / `failed`
- `result_path`：可为空
- `error`：可为空
- `created_at`
- `finished_at`

## 7. 标注 JSON 文件格式

标注 JSON 是每个图像的权威标注文件，存放于 `annotations/<图像文件名>.json`。

```json
{
  "schemaVersion": 1,
  "imageName": "img-001.png",
  "imageWidth": 1024,
  "imageHeight": 768,
  "shapes": [
    {
      "id": "a1b2c3",
      "label": "肿瘤",
      "shapeType": "polygon",
      "points": [[120, 80], [180, 90], [200, 160], [130, 170]]
    }
  ],
  "labelStatus": {
    "肿瘤": "present",
    "血管": "absent"
  },
  "version": 3,
  "updatedBy": "zhang",
  "updatedAt": "2026-07-31T15:00:00+08:00"
}
```

字段说明：

- `imageName`：对应原图文件名
- `imageWidth` / `imageHeight`：标注参考尺寸
- `shapes`：多边形列表，坐标使用像素
- `labelStatus`：每个标签的确认状态
- `version`：保存冲突检测版本号
- `updatedBy` / `updatedAt`：最近保存人和时间

### 版本一致性约定

> 用「作业本」比喻理解：每个图像有一本标注作业本，`version` 写在作业本内页，数据库 `annotation_rev` 是贴在封面上的便利贴——两个数字是同一个版本号，必须一致。

- `images.annotation_rev` 与 JSON 内的 `version` 是同一个逻辑版本号（数据库是 JSON 的镜像索引）
- 数据库冗余存储的目的是列表展示和并发校验时无需每次都打开 JSON 文件
- 前端加载标注时读取 `annotation_rev`，保存时将其作为 `expectedRev` 提交
- 后端保存时比较 `expectedRev` 与数据库当前 `annotation_rev`：
  - 一致 → 允许写入，JSON `version` 与数据库 `annotation_rev` 同时 +1
  - 不一致 → 返回 409，携带当前版本号，前端提示用户重新加载
- `annotation_rev` 不是「总保存次数」统计字段；如需统计保存次数，应单独增加计数字段
- 通过扫描导入已有 JSON 时，扫描服务应将 JSON 的 `version` 同步到 `annotation_rev`，避免两者漂移

## 8. 核心流程

### 8.1 扫描批次

1. 管理员配置工作目录
2. 扫描 `batches/*/images/` 下的支持格式图像
3. 新图像写入 `images`，检测到 sidecar JSON 时恢复 `annotation_rev`、`image_label_status`
4. 更新统计和批次状态

### 8.2 打开与编辑

1. 用户点击图像，前端调用 `POST /api/images/:id/lock`
2. 锁被占用时拒绝编辑，提示当前持锁人
3. 获取锁成功后加载图像（实际显示路径通过 `/api/images/:id` 返回）、标注 JSON、标签状态
4. 前端每 60 秒调用 `POST /api/images/:id/heartbeat` 续期
5. 用户编辑或确认标签，前端 300ms 防抖后自动保存 `PUT /api/images/:id/annotation`
6. 保存时后端校验 `expectedRev`，一致才写入；409 时前端提示用户
7. 保存后后端更新 `image_label_status`、sidecar JSON、mask PNG 文件和统计
8. 关闭图像、离开页面或浏览器关闭时调用 `DELETE /api/images/:id/lock` 主动释放锁
9. 异常断网/死机时心跳停止，30 分钟后锁自动过期，其他人可获取

### 8.3 ONNX 预分割

1. 用户在编辑器右侧 InferencePanel 选择已启用模型并触发推理
2. 后端创建 `inference_jobs` 记录，BackgroundTask 加载 ONNX 模型并执行推理
3. 成功后按类别生成 mask 结果，前端轮询到完成
4. 推理结果渲染在 DraftLayer（半透明蓝色），用户查看
5. 用户点「接受全部」/「接受此类别」→ 对应 shape 移入 editorStore.shapes，DraftLayer 清空
6. 接受后的 shape 与手动标注统一使用现有编辑工具继续修改
7. 标签状态在接受后仍为 pending，需用户手动确认

### 8.4 导出

1. 选择导出范围和格式
2. 后端检查未确认标签并返回警告列表
3. 用户确认后生成：
   - labelme JSON（每张图一个 JSON，含 shapes 和 labelStatus）
   - PNG mask（每张图每个标签一个 PNG，由多边形栅格化生成）
   - COCO JSON（Polygon segmentation 格式，shapes 顶点直接拍平）
4. 写入 `export/<时间戳>-<范围名>/`

## 9. 并发与错误处理

### 编辑锁协议

| 机制 | 参数 | 说明 |
| --- | --- | --- |
| 超时时间 | 30 分钟 | 心跳停止超过此时间锁自动过期 |
| 心跳间隔 | 60 秒 | 前端定时调用心跳端点，后端将倒计时重置 |
| 主动释放 | 页面关闭/离开/切换图像时 | 前端调用 DELETE 解锁 |
| 强制释放 | 管理员操作 | 管理员在图像列表中可强制释放锁 |

- 编辑锁超时后可由其他用户获取
- 保存时版本不一致返回 409，前端提示「该图像已被他人修改，请重新加载」，保留当前草稿
- 多通道图像转换失败时跳过该图像并记录错误信息
- 推理失败保留 `inference_jobs.error`，前端显示失败原因并允许重试
- 导出失败时保留已生成文件，返回失败清单
- 自动保存使用临时文件 + 原子替换（`tempfile + os.replace`），避免写坏标注文件

## 10. 测试策略

### 后端

- pytest 覆盖：
  - 认证与用户管理
  - 批次扫描与图像注册
  - 多边形栅格化、并集、差集
  - sidecar JSON 读写与版本冲突
  - 标签确认与统计计算
  - 编辑锁超时与心跳
  - ONNX 推理任务状态（mock 模型）
  - JSON / PNG mask / COCO 导出

### 前端

- Vitest + React Testing Library 覆盖：
  - 编辑器状态与撤销/重做（全量快照 + 逐顶点撤销）
  - 增加/裁剪模式切换
  - 快捷键
  - 自动保存 300ms 防抖与断网草稿
- Playwright 端到端覆盖：
  - 登录 → 扫描 → 标注 → 保存 → 导出
  - 预分割结果转草稿 → 接受 → 编辑 → 确认 → 保存

## 11. 分阶段实施

### 第一阶段：基础平台

- 建立 monorepo 骨架（backend + frontend）
- 登录、用户管理、工作目录设置
- 标签管理（CRUD + txt 导入含颜色）
- 批次扫描与网页上传
- 图像列表与状态展示

验收标准：可登录并扫描/上传一批图像，列表中能看到图像和完成状态。

### 第二阶段：标注编辑器

- 四层画布架构（ImageLayer、MaskLayer、DraftLayer、DrawingLayer）
- 多边形绘制、增加/裁剪、顶点编辑、删除
- 撤销/重做（全量快照 + 绘制中逐顶点撤销 + Esc 取消）
- 缩放/平移、快捷键
- 标签列表与颜色编辑（color picker）
- sidecar JSON 读写、300ms 防抖自动保存、原子写入
- 编辑锁（锁获取 + 60s 心跳 + 主动释放 + 30min 超时）
- 保存状态指示器

验收标准：可完成一张图的多边形标注并实时保存到工作目录，重新打开后恢复，关闭后锁释放。

### 第三阶段：防漏标、统计与导出

- present / absent / pending 确认面板
- 完成状态自动更新
- 统计面板与「最需要补充数据」提示
- JSON、PNG mask、COCO（Polygon 格式）导出
- 未确认标签导出警告

验收标准：可确认全部标签、查看统计，并导出包含空 mask 的完整结果包。

### 第四阶段：ONNX 预分割

- 模型配置管理
- BackgroundTask 推理 + 状态轮询
- GPU 自动检测与 CPU 回退
- DraftLayer 草稿渲染 + 接受/拒绝交互
- 预分割结果转 shapes → 编辑 → 确认 → 保存

验收标准：可为图像生成预分割草稿，接受后修改并确认，正常保存。

### 第五阶段：打磨与部署

- 大图性能优化（图像分块加载、Konva 虚拟化渲染）
- 端到端测试补全
- Docker 部署说明
- 使用文档

验收标准：可在目标服务器稳定运行，核心流程端到端通过。

## 12. 后续升级（非本期范围）

- 正式权限体系、任务分配、审核流程
- 浏览器端推理模式
- PostgreSQL、Redis、独立推理 worker（Celery/RQ）
- SAM 等交互式分割辅助
- WebSocket 实时多人协作编辑
- 标注历史版本回溯与 diff
