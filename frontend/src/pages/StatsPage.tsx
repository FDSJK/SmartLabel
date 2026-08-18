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
