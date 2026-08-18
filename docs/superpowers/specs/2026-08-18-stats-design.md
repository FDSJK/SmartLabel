# 统计面板（Stats）功能设计

> 日期：2026-08-18
> 状态：设计定案，待用户审阅
> 关联：主设计文档 §3.7「统计面板」、§509/§513 统计 API

## 1. 目标

提供一个精简的统计面板，按标签展示**阳性（present）/ 阴性（absent）/ 未确认（pending）**三列数量，支持**按批次 / 全部数据**切换，帮助标注员快速掌握标注进度与漏标情况。

## 2. 范围

**本次实现（精简版，数据看板）：**

- 按**启用标签**统计三个数量：`阳性(present)`、`阴性(absent)`、`未确认(pending)`，每个计数附**百分比**（阳性率 / 阴性率 / 待定率）。
- 支持**按批次 / 全部数据**切换。
- 表上方显示**数据总数**（当前范围的总图像数）。
- 页面标题「数据看板」，左侧统计表 + 右侧**堆叠横向条形图**（recharts）。
- **标签筛选**：搜索框（按名称模糊过滤）+ 多选下拉（勾选要显示的标签），表格与图表**同步**过滤。

**本次不做（暂缓）：**

- 完成率（指标定义待用户明确后再加）。
- 每位标注员已保存图像数。
- 「最需要补充数据」标签排序提示。

## 3. UI 布局

`StatsPage`（`/stats` 路由，登录可读），页面标题「**数据看板**」：

```
┌──────────────────────────────────────────────────────────────────┐
│ 数据看板                                                          │
│ 批次 [▼ 全部数据]  数据总数：10 张图像   [🔍 搜索] [▼ 标签筛选]       │
├─────────────────────────────────┬────────────────────────────────┤
│ 标签         | 阳性     | 阴性     | 未确认 │  按标签状态分布              │
│ AtrophicFoci | 3 (30%) | 2 (20%) | 5 (50%)│  ███████░░░░░░░░░ Atrophic… │
│ MaculaMembr  | 1 (10%) | 4 (40%) | 5 (50%)│  ██░░░░░░░░░░░░░░░ Macula…  │
│ …                                 │  …                          │
│                                   │  ■ 阳性  ■ 阴性  ■ 未确认（图例）  │
└─────────────────────────────────┴────────────────────────────────┘
```

- **范围**：批次下拉（含「全部数据」）。
- **筛选**：搜索框（按名称模糊过滤）+ 多选下拉（勾选要显示的标签，默认全选，含「全选 / 清空」）。表格与图表**同步**过滤。
- **表格**：每行一个启用标签，`计数 (百分比)`，百分比保留 1 位小数，总数为 0 显示 `-`；未确认列用 `--color-warning`。
- **图表**：右侧堆叠横向条形图（recharts），每标签一横条，三段 阳性 / 阴性 / 未确认，配色 `--color-success` / `--color-text-muted` / `--color-warning`，带 tooltip 与图例。

## 4. 数据口径

- **数据来源**：每张图的标签状态只存在于 sidecar JSON 的 `labelStatus`（DB 无 per-label 状态表），因此统计需扫描工作目录下的 sidecar 文件，复用 `read_annotation` + `_get_work_dir`（与导出功能一致）。
- **口径**（与导出闸门一致）：
  - `阳性(present)`：`labelStatus[label] == "present"` 的图像数。
  - `阴性(absent)`：`labelStatus[label] == "absent"` 的图像数。
  - `未确认(pending)`：状态为 `"pending"` **或缺失**的图像数。
- **只统计启用标签**（`Label.enabled == True`）。
- **数据总数** = 范围内图像数（按批次 = 该批次图像数；全部 = 所有图像数）。
- **百分比**（阳性率 / 阴性率 / 待定率）= 各自计数 ÷ 数据总数 × 100%，保留 1 位小数。三者之和恒为 100%（每张图对每个标签恰好落在一个状态）。百分比在前端由计数与总数计算，后端只返回原始计数。
- 边界：sidecar 缺失或解析失败 → 该图所有启用标签都计为 `未确认`（保守，符合「未确认」语义）。

## 5. API 契约

`GET /api/stats`

请求参数（可选）：

- `batch_id`：指定批次 id；**缺省或为 null 时统计全部**。

响应 200：

```json
{
  "totalImages": 10,
  "labels": [
    { "name": "AtrophicFoci", "present": 3, "absent": 2, "pending": 5 },
    { "name": "MaculaMembrane", "present": 1, "absent": 4, "pending": 5 }
  ]
}
```

- `labels` 按启用标签的 `sort_order`、`id` 排序。
- 无图像时返回 `totalImages: 0, labels: []`（labels 仍列出全部启用标签，计数为 0）。

## 6. 后端实现

- 新增 `services/stats.py`：

  ```python
  def compute_stats(work_dir: str, db, batch_id: int | None = None) -> dict:
      """返回 {"total_images": int, "labels": [{"name","present","absent","pending"}, ...]}"""
  ```

- 新增 `api/stats.py`：`GET /stats`（`response_model=StatsResponse`），复用 `_get_work_dir(db)`。
- 在 `api/__init__.py` 注册路由。
- 新增 `schemas/stats.py`：`StatsResponse`（`totalImages` + `labels` 列表）。

## 7. 前端实现

- 新增 `api/stats.ts`：`fetchStats(batchId?: number | null)`。
- 新增依赖 `recharts`（`npm install recharts`）。
- 重写 `StatsPage.tsx`（标题「数据看板」，两栏布局）：
  - 从 `batchStore` 读取批次列表做下拉（含「全部数据」）。
  - 范围变化或初次加载时 `fetchStats`。
  - **筛选**：搜索框（`useState` 字符串，`label.name.includes(q)`）+ 多选下拉（复选框列表，默认全选，含「全选 / 清空」）。过滤得到 `visibleLabels`，表格与图表都用它。
  - 左侧统计表（未确认列 `--color-warning`）。
  - 右侧 recharts 堆叠横向条形图（`BarChart layout="vertical"`，三个 `Bar` 同一 `stackId`，配色见 §3），带 `<Tooltip>` 与图例。

## 8. 与遗留缺口的关系

- 「完成状态自动更新」的 `in_progress → done` 缺口（第三阶段遗留）**与本次统计面板解耦**：本次统计不依赖 `done` 字段，直接从 sidecar `labelStatus` 实时计算。该缺口另行处理。
- 完成率指标：待用户明确定义后再加入（后续小改动）。

## 9. 测试

- 后端单测 `tests/test_stats.py`：造一个批次 + 多张图的 sidecar，验证 present/absent/pending 计数、batch/global 切换、缺失标签计 pending、无图返回空。
- 端点测试：`GET /api/stats` 与 `GET /api/stats?batch_id=X` 返回结构正确。
- 前端 `StatsPage` 数据渲染（可选）。
