import { useEffect, useRef, useState } from 'react';
import { useBatchStore } from '../../stores/batchStore';
import styles from './BatchSelector.module.css';

export default function BatchSelector() {
  const { batches, currentBatchId, loadBatches, selectBatch, doScan, doCreateAndUpload, loading } = useBatchStore();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchNameRef = useRef<string>('');

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handleScan = async () => {
    const result = await doScan();
    alert(`扫描完成：新增 ${result.added}，跳过 ${result.skipped}`);
  };

  const handleUploadClick = () => {
    const name = prompt('输入批次名称：');
    if (!name) return;
    batchNameRef.current = name;
    fileRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const name = batchNameRef.current;
    if (!name || files.length === 0) return;
    setUploading(true);
    try {
      await doCreateAndUpload(name, files);
    } catch {
      alert('上传失败');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={currentBatchId ?? ''}
        onChange={(e) => { const id = Number(e.target.value); if (id) selectBatch(id); }}
        disabled={loading}
      >
        <option value="">-- 选择批次 --</option>
        {batches.map(b => (
          <option key={b.id} value={b.id}>{b.name} ({b.done_count}/{b.image_count})</option>
        ))}
      </select>
      <div className={styles.actions}>
        <button className={styles.btn} onClick={handleScan} disabled={loading}>扫描</button>
        <button className={styles.btn} onClick={handleUploadClick} disabled={uploading}>
          {uploading ? '上传中...' : '上传'}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/tiff" multiple
          onChange={handleFilesSelected} hidden />
      </div>
    </div>
  );
}
