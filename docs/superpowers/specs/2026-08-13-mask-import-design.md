# 二值 mask 导入功能设计

> 日期：2026-08-13
> 状态：已确认方案 A，待用户评审
> 关联：[2026-07-31-online-annotation-tool-design.md](./2026-07-31-online-annotation-tool-design.md)

## 1. 背景与目标

当前软件以「多边形 + sidecar JSON」为权威标注格式，标注通过手工绘制产生。用户已有现成的二值分割标签数据（每个标签一张二值图，PNG 或 JPG），希望批量导入到软件中，并同步写入 JSON 标注文件，从而复用现有的渲染/编辑/导出能力。

核心思路：**把栅格二值 mask 矢量化成多边形，再写入 sidecar JSON**。前端零改动。

## 2. 数据约定

### 2.1 mask 文件组织

```
batches/<batch>/
  images/
    img-001.png
  masks/
    cat/            ← 子目录名 = 标签名
      img-001.png   ← 文件名 = 原图文件名（去掉扩展名）
      img-002.jpg
    dog/
      img-001.png
  annotations/
    img-001.json    ← 导入后生成
```

规则：

- `masks/` 下**每个子目录对应一个标签**，子目录名即标签名。
- 子目录内的二值图**文件名与原图文件名一致**（仅扩展名可为 `.png`/`.jpg`/`.jpeg`）。
- 同一张原图可在多个标签子目录下各有一张 mask。
- 只扫描 `masks/` 的**直接子目录**；`masks/` 下的平铺文件、非图片文件一律忽略。

### 2.2 与「多边形→mask 导出」的关系

未来的「多边形→mask 导出」采用**同一约定**：`masks/<标签名>/<原图文件名>.png`（文件夹名即标签名，二值图文件名与原图一致），不使用 `<stem>__<label>.png` 命名。导入与导出共用同一布局，支持往返。

## 3. 处理流程

### 3.1 矢量化（`mask_import.vectorize_mask`）

输入一张二值图，输出多边形列表。

1. Pillow 打开 → `convert("L")` 转灰度（兼容 RGB 三通道的"二值"图）。
2. NumPy 阈值化：`(arr > 128).astype(np.uint8) * 255`。
   - **原因**：JPG 有损压缩使分割边缘出现 0–255 之间的插值，需先以 128 为界二值化。
3. OpenCV `findContours(binary, RETR_CCOMP, CHAIN_APPROX_SIMPLE)`。
   - `RETR_CCOMP` 同时提取外轮廓与内轮廓（孔洞），通过 hierarchy 把孔洞归到其外环下。
4. 每个轮廓用 `approxPolyDP(contour, epsilon, closed=True)` 简化，`epsilon = max(1.0, 0.005 * arcLength)`。
5. 过滤面积 `< 4px` 的噪声轮廓；点数 `< 3` 的丢弃。
6. 输出 `list[dict]`，每个多边形为 `{"points": [[x,y], ...], "holes": [[[x,y], ...], ...]}`。

### 3.2 空标注判定

「空标注图像」= **无 sidecar JSON**，**或** JSON 存在且 `shapes` 为空。

- 满足条件 → 执行 mask 导入。
- 已有非空标注 → 跳过，不覆盖人工工作。

### 3.3 导入（`mask_import.import_batch_masks` / `import_image_masks`）

对批次中每张「空标注」图像：

1. 遍历 `masks/` 的每个标签子目录，查找 `<原图文件名>.<png|jpg|jpeg>`。
2. 无任何 mask 文件 → 该图像保持原样（无 JSON，`annotation_rev=0`）。
3. 有 mask 文件：
   - 逐个矢量化；**尺寸与原图宽高不一致 → 跳过该 mask，并把数据文件名写入错误日志（errors），继续其它图像**。
   - 标签不存在 → 自动创建 `Label(name=子目录名, color=调色板取色, enabled=True)`。
   - 汇总为 `shapes`（每个多边形一个 shape：`id=uuid, label=标签名, shapeType="polygon", points=顶点`）。
   - `labelStatus` 中，被导入过 mask 的标签置 `present`；无 mask 的标签不写入（保持 pending）。
   - 调用 `annotation_store.write_annotation` 写入 JSON（`version=1`）。
   - 更新 `image.annotation_rev = 1`；`image.status` 保持 `pending`（预标注，非人工确认）。

### 3.4 触发方式

- **扫描时自动导入**：`scanner.scan_batches` 在创建图像、判定为空标注后调用 `import_image_masks`。
- **独立重导端点**：`POST /api/batches/{batch_id}/import-masks`（管理员），复用同一 service，返回 `{imported, skipped, errors, created_labels}`。
- **幂等**：已导入的图像有 shapes → 非空标注 → 重跑自动跳过。

## 4. 组件与文件变更

| 文件 | 变更 |
| --- | --- |
| `backend/app/services/mask_import.py` | 新增：`vectorize_mask`、`import_image_masks`、`import_batch_masks` |
| `backend/app/services/scanner.py` | 空标注图像调用 mask 导入；错误日志汇总进返回的 `errors` |
| `backend/app/api/batches.py` | 新增 `POST /batches/{id}/import-masks` 端点 |
| `backend/app/services/image_processor.py` | 无需改动（复用 `get_image_info` 做尺寸校验） |
| `backend/pyproject.toml` | 新增依赖 `opencv-python-headless>=4.9.0` |
| 前端 | 无改动 |

## 5. 错误处理

- 单个 mask 无法打开 / 尺寸与原图不一致 → 记入 `errors`（含数据文件名与原因），跳过，继续其它图像。
- 标签子目录名无效（如隐藏目录 `.DS_Store`）→ 忽略。
- 写入 JSON 失败 → 记入 `errors`，该图像保持无标注。

## 6. 已知限制

- `RETR_CCOMP` 仅两层：孔内的孤岛会被当作独立外环（极端嵌套场景，实践中罕见）。
- 孔顶点不可单独拖拽编辑（顶点手柄只作用于外环）；整体移动、增添/裁剪会保留孔。
- 自动创建标签的颜色为调色板轮转分配，颜色可后续在标签管理中修改。
- 导入的 mask 为预标注，图像 `status` 仍为 `pending`，需人工在「标签状态」确认后方计为完成。

## 7. 测试

- `vectorize_mask`：
  - 合成矩形/圆形二值图 → 断言输出多边形近似覆盖对应区域。
  - 构造 0–255 梯度边缘 → 断言 128 阈值二值化正确（≤128 为背景、>128 为前景）。
- `import_batch_masks`（临时工作目录）：
  - 自动创建标签、JSON 内容正确（shapes/labelStatus）、`annotation_rev=1`。
  - 有非空标注的图像被跳过。
  - 尺寸不匹配的 mask 被跳过并写入 errors。
  - 重跑幂等（第二次全部 skipped）。
