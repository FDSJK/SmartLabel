import { useEffect, useState } from 'react';
import { useBatchStore } from '../stores/batchStore';
import { fetchStats, type StatsResponse } from '../api/stats';
import styles from './StatsPage.module.css';

export default function StatsPage() {
  const { batches, loadBatches } = useBatchStore();
  const [scope, setScope] = useState<number | null>(null); // null = 全部
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadBatches(); }, [loadBatches]);

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

  function pct(n: number, total: number): string {
    if (total === 0) return '-';
    return ((n / total) * 100).toFixed(1) + '%';
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>统计</h2>
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

      {loading && <p className={styles.hint}>加载中…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <>
          <p className={styles.total}>数据总数：{data.totalImages} 张图像</p>
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
              {data.labels.map(l => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td>{l.present} ({pct(l.present, data.totalImages)})</td>
                  <td>{l.absent} ({pct(l.absent, data.totalImages)})</td>
                  <td className={styles.pending}>{l.pending} ({pct(l.pending, data.totalImages)})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
