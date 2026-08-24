import { useEffect } from 'react';
import { useBatchStore } from '../../stores/batchStore';
import { useImageStore } from '../../stores/imageStore';
import { useInferenceStore } from '../../stores/inferenceStore';
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

export default function ImageList() {
  const { images, loading, currentBatchId } = useBatchStore();
  const loadImage = useImageStore(s => s.loadImage);
  const currentImageId = useImageStore(s => s.currentImage?.id);
  const jobsByImage = useInferenceStore(s => s.jobsByImage);

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

  if (images.length === 0) {
    return <div className={styles.empty}>暂无图像</div>;
  }

  async function handleClick(imageId: number) {
    await loadImage(imageId);
  }

  return (
    <div className={styles.list}>
      {images.map(img => {
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
              title={STATUS_LABELS[img.status] || img.status}
              style={{
                color: img.status === 'done' ? 'var(--color-success)'
                  : img.status === 'in_progress' ? 'var(--color-warning)'
                  : 'var(--color-text-muted)',
              }}>
              {STATUS_ICONS[img.status] || '○'}
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
  );
}
