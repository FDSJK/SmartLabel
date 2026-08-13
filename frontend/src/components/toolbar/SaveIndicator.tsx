import { useUIStore } from '../../stores/uiStore';
import styles from './SaveIndicator.module.css';

const STATUS_MAP: Record<string, { text: string; className: string }> = {
  saved: { text: '已保存', className: 'saved' },
  saving: { text: '保存中…', className: 'saving' },
  unsaved: { text: '未保存', className: 'unsaved' },
  offline: { text: '离线', className: 'offline' },
};

export default function SaveIndicator() {
  const saveStatus = useUIStore(s => s.saveStatus);
  const info = STATUS_MAP[saveStatus] || STATUS_MAP.saved;

  return (
    <span className={`${styles.indicator} ${styles[info.className]}`}>
      <span className={styles.dot} />
      {info.text}
    </span>
  );
}
