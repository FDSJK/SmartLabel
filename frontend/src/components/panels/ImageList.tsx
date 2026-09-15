import { useEffect, useState } from 'react';
import { useBatchStore } from '../../stores/batchStore';
import { useImageStore } from '../../stores/imageStore';
import { useInferenceStore } from '../../stores/inferenceStore';
import { setImageFlag } from '../../api/images';
import type { ImageInfo } from '../../types/api';
import styles from './ImageList.module.css';

const STATUS_LABELS: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  done: '已完成',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
};

const INFER_STATUS: Record<string, { label: string; color: string }> = {
  queued: { label: '排队', color: 'var(--color-text-muted)' },
  running: { label: '推理中', color: 'var(--color-warning)' },
  done: { label: '完成', color: 'var(--color-success)' },
  failed: { label: '失败', color: 'var(--color-error)' },
};

// 左侧列表圆点的「可见颜色」筛选选项：红=重点标记，绿=已完成，黄=进行中
const COLOR_OPTIONS = [
  { key: 'green', color: 'var(--color-success)', title: '已完成（绿色）' },
  { key: 'red', color: 'var(--color-danger)', title: '重点标记（红色）' },
  { key: 'yellow', color: 'var(--color-warning)', title: '进行中（黄色）' },
] as const;
type ColorKey = (typeof COLOR_OPTIONS)[number]['key'];

/** 图像圆点当前实际显示的颜色：红 > 绿/黄；灰色（未开始）返回 null，不可筛选。 */
function visibleColor(img: ImageInfo): ColorKey | null {
  if (img.flagged) return 'red';
  if (img.status === 'done') return 'green';
  if (img.status === 'in_progress') return 'yellow';
  return null;
}

export default function ImageList() {
  const { images, loading, currentBatchId } = useBatchStore();
  const loadImage = useImageStore(s => s.loadImage);
  const currentImageId = useImageStore(s => s.currentImage?.id);
  const jobsByImage = useInferenceStore(s => s.jobsByImage);
  const updateImageFlag = useBatchStore(s => s.updateImageFlag);
  const [query, setQuery] = useState('');
  const [selectedColors, setSelectedColors] = useState<Set<ColorKey>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  // 切换批次时加载该批次的推理任务状态，并在有排队/运行中任务时轮询更新
  useEffect(() => {
    const store = useInferenceStore.getState();
    if (currentBatchId) {
      store.startPolling(currentBatchId);
    } else {
      store.clear();
      store.stopPolling();
    }
  }, [currentBatchId]);

  if (!currentBatchId) {
    return <div className={styles.empty}>请选择批次</div>;
  }

  if (loading) {
    return <div className={styles.empty}>加载中...</div>;
  }

  async function handleClick(imageId: number) {
    await loadImage(imageId);
  }

  // 切换「重点标记」：乐观更新本地列表，失败时回滚
  function toggleFlag(img: ImageInfo) {
    const next = !img.flagged;
    updateImageFlag(img.id, next);
    setImageFlag(img.id, next).catch(() => updateImageFlag(img.id, img.flagged));
  }

  function toggleColor(key: ColorKey) {
    setSelectedColors(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = images.filter(img => {
    const matchesQuery = !q || img.file_name.toLowerCase().includes(q);
    const color = visibleColor(img);
    const matchesColor = selectedColors.size === 0 || (color !== null && selectedColors.has(color));
    return matchesQuery && matchesColor;
  });

  return (
    <div className={styles.wrapper}>
      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          type="search"
          placeholder="筛选图像…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.filterDropdown}>
          <button
            className={`${styles.filterTrigger} ${selectedColors.size > 0 ? styles.filterTriggerActive : ''}`}
            onClick={() => setFilterOpen(o => !o)}
            title="按颜色筛选"
            aria-haspopup="listbox"
            aria-expanded={filterOpen}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {selectedColors.size > 0 && (
              <span className={styles.filterCount}>{selectedColors.size}</span>
            )}
          </button>
          {filterOpen && (
            <>
              <div className={styles.dropdownBackdrop} onClick={() => setFilterOpen(false)} />
              <div className={styles.dropdownMenu} role="listbox" aria-multiselectable="true">
                {COLOR_OPTIONS.map(opt => {
                  const active = selectedColors.has(opt.key);
                  return (
                    <button
                      key={opt.key}
                      className={`${styles.dropdownItem} ${active ? styles.dropdownItemActive : ''}`}
                      onClick={() => toggleColor(opt.key)}
                      role="option"
                      aria-selected={active}
                      title={opt.title}
                    >
                      <span className={styles.colorDot} style={{ background: opt.color }} />
                      <span className={styles.dropdownCheck}>{active ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {images.length === 0 ? (
        <div className={styles.empty}>暂无图像</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>无匹配图像</div>
      ) : (
        <div className={styles.list}>
          {filtered.map(img => {
            const job = jobsByImage[img.id];
            const infer = job ? INFER_STATUS[job.status] : null;

            return (
              <div
                key={img.id}
                className={`${styles.item} ${currentImageId === img.id ? styles.itemActive : ''}`}
                onClick={() => handleClick(img.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleClick(img.id); }}
              >
                <span className={styles.status}
                  title={img.flagged
                    ? '重点标记（点击取消）'
                    : `${STATUS_LABELS[img.status] || img.status}（点击标记为重点）`}
                  style={{
                    color: img.flagged ? 'var(--color-danger)'
                      : img.status === 'done' ? 'var(--color-success)'
                      : img.status === 'in_progress' ? 'var(--color-warning)'
                      : 'var(--color-text-muted)',
                  }}
                  onClick={(e) => { e.stopPropagation(); toggleFlag(img); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFlag(img);
                    }
                  }}>
                  {img.flagged ? '●' : (STATUS_ICONS[img.status] || '○')}
                </span>
                <span className={styles.name}>{img.file_name}</span>
                {infer && (
                  <span
                    className={styles.inferBadge}
                    style={{ color: infer.color }}
                    title={job.status === 'failed' ? (job.error || '推理失败') : infer.label}
                  >
                    {infer.label}
                  </span>
                )}
                {img.locked_by_username && (
                  <span className={styles.lock} title={`被 ${img.locked_by_username} 锁定`}>🔒</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
