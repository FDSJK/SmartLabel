# 导出（Export）功能设计

> 日期：2026-08-17
> 状态：设计定案，待用户审阅
> 关联：主设计文档 §3.9「导出」、§5.6 导出 API、§8.4 导出流程

## 1. 目标

为标注结果提供批量导出：按三种范围（当前图像 / 当前批次 / 全部批次）× 三种格式（PNG 二值 mask、COCO、labelme JSON）导出到工作目录的 `export/` 下，作为不可再变的快照。导出前对「未确认（pending）标签」做警告闸门。

## 2. 范围与格式

| 范围 | 说明 |
| --- | --- |
| `image` | 单张图像（需 `imageId`） |
| `batch` | 某批次全部图像（需 `batchId`） |
| `all` | 全部批次全部图像 |

| 格式 | 产物 |
| --- | --- |
| `mask` | `masks/<标签名>/<原图stem>.png`，每图每标签一张 |
| `coco` | `coco/annotations.json`，整个范围一个文件 |
| `labelme` | `labelme/<原图stem>.json`，每图一个文件 |

## 3. 输出目录

```
<工作目录>/export/<YYYYMMDD-HHMMSS>-<范围名>/
  coco/annotations.json      # 选了 coco 才生成
  labelme/<stem>.json        # 选了 labelme 才生成
  masks/<标签名>/<stem>.png   # 选了 mask 才生成
```

范围名：`image-<stem>` / `batch-<批次名>` / `all`。

> 注意：mask 命名用 `masks/<标签名>/<原图名>.png`，与当前工作 mask 目录约定一致（可回导），
> **不**采用主设计文档 §4 里的 `img-001__label-a.png`（该旧约定已被 mask 导出设计替换）。

## 4. 二值 mask 规则（§3.9 原文）

- `present` → 由 shapes 栅格化 0/255（填外环 + 挖孔，复用 `mask_export.shapes_to_masks`）
- `absent` → 全 0 空白 mask
- `pending` → 不生成，导出前警告

## 5. 孔洞（holes）处理

shape 数据模型带可选 `holes`（内环列表）。三种格式对孔洞的处理：

| 格式 | 处理 | 说明 |
| --- | --- | --- |
| **PNG mask** | 精确 | `fillPoly` 填外环 + 挖孔 |
| **COCO** | 多边形列表（相反绕向）+ RLE | 见 §5.1 |
| **labelme** | 孔洞标为 `_background_` | 见 §5.2 |

### 5.1 COCO：多边形 + RLE 双表示

每条 annotation 同时携带两种表示，兼顾「可读顶点」与「精确掩码」：

- `segmentation`（Polygon 格式）：`[外环_拍平, 孔洞1_拍平, 孔洞2_拍平, ...]`
  - 外环归一化为**逆时针**（有向面积为正），孔洞归一化为**顺时针**（有向面积为负），二者绕向相反
  - 一个 (图, 标签) 对应一条 annotation；同一标签多个分离区域（多个 shape）的外环/孔洞按 shape 顺序依次追加到同一 `segmentation` 数组
- `segmentation_rle`（未压缩 RLE）：`{"counts": [游程列表], "size": [h, w]}`
  - 精确表示含孔洞的二值掩码（列主序 Fortran 展平，游程以背景 0 开头、交替、以 0 结尾、条目数为偶数）
  - 可用 `pycocotools.mask.frUncompressedRLE(rle)` 解码
- `area` = 外环面积和 − 孔洞面积和（正值）
- `bbox` = 外环包围盒 `[x, y, w, h]`
- `iscrowd` = 0

> 说明：COCO 的 `segmentation` Polygon 格式在 pycocotools 默认转换（`merge` 求并集）下会把孔洞填实；
> 因此额外提供 `segmentation_rle` 作为精确通道。需要精确孔洞的消费者读 `segmentation_rle`（或直接用 PNG mask）。

### 5.2 labelme：孔洞标为 `_background_`

- 每个 shape 的外环 → 一条 shape：`{"label": <标签>, "points": 外环, "group_id": null, "shape_type": "polygon", "flags": {}}`
- 每个孔洞 → 一条 shape：`{"label": "_background_", "points": 孔洞, "group_id": null, "shape_type": "polygon", "flags": {}}`

`_background_` 是本系统保留标签名，用作「孔洞/背景」语义，与 §3.4 保留名一致。

## 6. COCO 结构

```json
{
  "images": [{ "id": 3, "file_name": "a.png", "width": 1024, "height": 768 }],
  "annotations": [
    {
      "id": 1,
      "image_id": 3,
      "category_id": 2,
      "segmentation": [[10,10, 50,10, 50,50, 10,50], [20,20, 30,20, 30,30, 20,30]],
      "segmentation_rle": { "counts": [ ... ], "size": [768, 1024] },
      "area": 1500.0,
      "bbox": [10, 10, 40, 40],
      "iscrowd": 0
    }
  ],
  "categories": [
    { "id": 1, "name": "cat", "supercategory": "" },
    { "id": 2, "name": "dog", "supercategory": "" }
  ]
}
```

- `images[].id` = 图像数据库 id；`categories[].id` = 标签数据库 id；`annotations[].id` = 从 1 递增
- `categories` 列出所有**启用**标签
- 仅 `present` 且带 shapes 的标签产生 annotation（absent/pending 无 shape，不产生）

## 7. labelme 结构

```json
{
  "version": "5.2.1",
  "flags": {},
  "shapes": [
    { "label": "cat", "points": [[10,10], ...], "group_id": null, "shape_type": "polygon", "flags": {} },
    { "label": "_background_", "points": [[20,20], ...], "group_id": null, "shape_type": "polygon", "flags": {} }
  ],
  "imagePath": "a.png",
  "imageData": null,
  "imageHeight": 768,
  "imageWidth": 1024,
  "labelStatus": { "cat": "present", "dog": "absent" }
}
```

- `shapes` 含外环 + `_background_` 孔洞；`labelStatus` 为非标准扩展字段（§3.9「含 shapes 和 labelStatus」），完整透传该图的 labelStatus

## 8. 未确认标签闸门

- 请求带 `skipUnconfirmed`（默认 false）
- 后端扫范围内所有**启用**标签：状态缺失或为 `pending` 者记为「未确认」
- 存在未确认且 `skipUnconfirmed=false` → 返回 `409`，body `detail` 为：
  ```json
  { "code": "unconfirmed_labels", "pending": [{ "image": "a.png", "labels": ["dog"] }] }
  ```
- 前端弹确认；用户确认后带 `skipUnconfirmed=true` 重试，pending 标签跳过（mask 不生成、COCO 无 annotation、labelme 仅在 labelStatus 体现）

## 9. API 契约

`POST /api/export`

请求体：

```json
{ "scope": "batch", "imageId": null, "batchId": 1,
  "formats": ["mask", "coco", "labelme"], "skipUnconfirmed": false }
```

- `scope`：`image` | `batch` | `all`
- `imageId`：`scope=image` 时必填；`batchId`：`scope=batch` 时必填
- `formats`：`["mask", "coco", "labelme"]` 子集，至少一项

响应 200：

```json
{
  "exportDir": "export/20260817-153000-batch-20260814",
  "imageCount": 10,
  "annotationCount": 34,
  "maskCount": 28,
  "pending": [{ "image": "a.png", "labels": ["dog"] }],
  "errors": [{ "file": "b.png", "error": "corrupt annotation" }]
}
```

- 单图/单标签出错不中断整体导出（§9「导出失败时保留已生成文件，返回失败清单」）

## 10. 前端入口

- 独立导出对话框（`ExportDialog`），由画布浮动工具条新增「导出」按钮打开
- 对话框内含：范围单选（当前图像 / 当前批次 / 全部批次）、格式多选（PNG mask / COCO / labelme）、开始导出按钮
- 收到 409 后在对话框内展示未确认清单，供「忽略并继续 / 取消」
- 成功后展示 `exportDir` 与统计（图像数 / annotation 数 / mask 数 / 错误清单）
