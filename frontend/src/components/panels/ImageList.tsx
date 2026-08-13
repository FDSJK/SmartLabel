import { useBatchStore } from '../../stores/batchStore';
import { useImageStore } from '../../stores/imageStore';
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

export default function ImageList() {
  const { images, loading, currentBatchId } = useBatchStore();
  const loadImage = useImageStore(s => s.loadImage);
  const currentImageId = useImageStore(s => s.currentImage?.id);

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
      {images.map(img => (
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
          {img.locked_by_username && (
            <span className={styles.lock} title={`被 ${img.locked_by_username} 锁定`}>🔒</span>
          )}
        </div>
      ))}
    </div>
  );
}
