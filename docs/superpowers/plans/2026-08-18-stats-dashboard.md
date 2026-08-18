# 数据看板（统计图表 + 标签筛选）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把统计页升级为「数据看板」：标题改名，左侧统计表 + 右侧 recharts 堆叠横向条形图，并加标签筛选（搜索框 + 多选下拉），表格与图表同步过滤。

**Architecture:** 纯前端改动（后端 `/api/stats` 已返回全部标签计数，无需改）。重写 `StatsPage.tsx`（两栏布局 + 图表 + 筛选），更新 `StatsPage.module.css`，新增依赖 `recharts`。

**Tech Stack:** React + TypeScript + Zustand + recharts。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-08-18-stats-design.md`。
- 标题「数据看板」；左表 + 右图两栏。
- 图表：recharts `BarChart layout="vertical"`，三个 `Bar` 同 `stackId` 堆叠（阳性/阴性/未确认），配色 阳性 `#16a34a`（--color-success）/ 阴性 `#64748b`（--color-text-muted）/ 未确认 `#f59e0b`（--color-warning），带 `<Tooltip>` + `<Legend>`。**注**：SVG `fill` 属性不支持 `var()`，故图表色用 hex 硬编码（值对齐 token）。
- 筛选：搜索框（`name.toLowerCase().includes(q)`）+ 多选下拉（复选框列表，默认全选，含「全选/清空」）。`visibleLabels` 同时过滤表格与图表。
- 百分比 = 计数 ÷ 数据总数 × 100%，保留 1 位小数，总数为 0 显示 `-`；未确认列 `--color-warning`。
- 验证：`cd frontend && npx tsc --noEmit && npx vite build`（vite chunk >500kB 警告为既有，可忽略）。无组件级单测（沿用前端现状：仅 store/logic 测试）。

---

### Task 1: 数据看板前端改造

**Files:**
- Modify: `frontend/src/pages/StatsPage.tsx`
- Modify: `frontend/src/pages/StatsPage.module.css`
- Modify: `frontend/package.json`（新增 `recharts` 依赖）

**Interfaces:**
- Consumes（Task 1 已完成）：`GET /api/stats?batch_id=` → `{totalImages, labels:[{name,present,absent,pending}]}`；`useBatchStore` 的 `batches`/`loadBatches`；`api/stats.ts` 的 `fetchStats`。

- [ ] **Step 1: 安装 recharts**

Run: `cd frontend && npm install recharts`

- [ ] **Step 2: 重写 StatsPage.tsx**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useBatchStore } from '../stores/batchStore';
import { fetchStats, type StatsResponse } from '../api/stats';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import styles from './StatsPage.module.css';

const CHART_COLORS = {
  present: '#16a34a',   // --color-success
  absent: '#64748b',    // --color-text-muted
  pending: '#f59e0b',   // --color-warning
};

export default function StatsPage() {
  const { batches, loadBatches } = useBatchStore();
  const [scope, setScope] = useState<number | null>(null); // null = 全部
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => { loadBatches().catch(() => {}); }, [loadBatches]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStats(scope)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('加载统计失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const labels = data?.labels ?? [];
  const visibleLabels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labels.filter(l => {
      const nameMatch = q === '' || l.name.toLowerCase().includes(q);
      const selectedMatch = selected === null || selected.has(l.name);
      return nameMatch && selectedMatch;
    });
  }, [labels, search, selected]);

  function pct(n: number, total: number): string {
    if (total === 0) return '-';
    return ((n / total) * 100).toFixed(1) + '%';
  }

  function toggleLabel(name: string) {
    setSelected(prev => {
      const base = prev ?? new Set(labels.map(l => l.name));
      const next = new Set(base);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const total = data?.totalImages ?? 0;

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>数据看板</h2>

      <div className={styles.controls}>
        <select
          className={styles.select}
          value={scope ?? ''}
          onChange={e => setScope(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">全部数据</option>
          {batches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <span className={styles.total}>数据总数：{total} 张图像</span>

        <input
          className={styles.search}
          type="text"
          placeholder="搜索标签…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={styles.filterWrap}>
          <button className={styles.filterBtn} onClick={() => setFilterOpen(o => !o)}>
            标签筛选 {selected === null ? `(${labels.length})` : `(${selected.size})`}
          </button>
          {filterOpen && (
            <div className={styles.filterPanel}>
              <div className={styles.filterActions}>
                <button className={styles.linkBtn} onClick={() => setSelected(null)}>全选</button>
                <button className={styles.linkBtn} onClick={() => setSelected(new Set())}>清空</button>
              </div>
              <div className={styles.filterList}>
                {labels.map(l => (
                  <label key={l.name} className={styles.filterItem}>
                    <input
                      type="checkbox"
                      checked={selected === null || selected.has(l.name)}
                      onChange={() => toggleLabel(l.name)}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {loading && <p className={styles.hint}>加载中…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <div className={styles.layout}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>标签</th>
                <th>阳性</th>
                <th>阴性</th>
                <th>未确认</th>
              </tr>
            </thead>
            <tbody>
              {visibleLabels.map(l => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td>{l.present} ({pct(l.present, total)})</td>
                  <td>{l.absent} ({pct(l.absent, total)})</td>
                  <td className={styles.pending}>{l.pending} ({pct(l.pending, total)})</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height={Math.max(200, visibleLabels.length * 28)}>
              <BarChart layout="vertical" data={visibleLabels} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={150} />
                <Tooltip />
                <Legend />
                <Bar dataKey="present" name="阳性" stackId="a" fill={CHART_COLORS.present} />
                <Bar dataKey="absent" name="阴性" stackId="a" fill={CHART_COLORS.absent} />
                <Bar dataKey="pending" name="未确认" stackId="a" fill={CHART_COLORS.pending} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 重写 StatsPage.module.css**

```css
.page { padding: 24px; max-width: 1100px; }
.heading { font-size: 20px; margin-bottom: 16px; }
.controls { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.select { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; min-width: 180px; }
.total { font-size: 14px; }
.search { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 14px; min-width: 160px; }
.filterWrap { position: relative; }
.filterBtn { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); font-size: 14px; cursor: pointer; }
.filterPanel { position: absolute; top: calc(100% + 4px); right: 0; width: 220px; max-height: 300px; overflow: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-md); z-index: 10; padding: 8px; }
.filterActions { display: flex; gap: 12px; margin-bottom: 6px; }
.linkBtn { background: none; border: none; color: var(--color-primary); font-size: 12px; cursor: pointer; padding: 0; }
.filterList { display: flex; flex-direction: column; gap: 4px; }
.filterItem { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.hint { color: var(--color-text-muted); font-size: 13px; }
.error { color: var(--color-danger); font-size: 13px; }
.layout { display: flex; gap: 24px; align-items: flex-start; }
.table { flex: 1; min-width: 0; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 8px 12px; border-bottom: 1px solid var(--color-border); text-align: left; }
.table th { color: var(--color-text-muted); font-weight: 600; }
.pending { color: var(--color-warning); }
.chart { flex: 1; min-width: 320px; }
```

- [ ] **Step 4: 类型检查与构建**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: tsc 退出码 0；`vite build` 成功。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/StatsPage.tsx frontend/src/pages/StatsPage.module.css frontend/package.json frontend/package-lock.json
git commit -m "feat(stats): add dashboard chart and label filtering"
```

---

## 验证（端到端）

1. `cd frontend && npx tsc --noEmit && npx vite build` 通过。
2. 手工：进入 `/stats`，确认标题「数据看板」；切换批次/全部；搜索框过滤；多选下拉勾选/全选/清空；表格与右侧堆叠条形图同步变化；tooltip/图例正常。
