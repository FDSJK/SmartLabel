import { useEffect, useRef, useState } from 'react';
import { useBatchStore } from '../../stores/batchStore';
import { ApiError } from '../../api/client';
import styles from './BatchSelector.module.css';

export default function BatchSelector() {
  const { batches, currentBatchId, loadBatches, selectBatch, deselectBatch, doScan, doCreateAndUpload, doUploadToBatch, doDeleteBatch, loading } = useBatchStore();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<'new' | 'existing'>('new');
  const batchNameRef = useRef<string>('');

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handleScan = async () => {
    const result = await doScan();
    alert(`扫描完成：新增 ${result.added}，跳过 ${result.skipped}，清理 ${result.removed}`);
  };

  const handleUploadClick = () => {
    if (currentBatchId) {
      // 上传到已选中批次
      uploadTarget.current = 'existing';
    } else {
      // 新建批次
      const name = prompt('输入批次名称：');
      if (!name) return;
      batchNameRef.current = name;
      uploadTarget.current = 'new';
    }
    fileRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      if (uploadTarget.current === 'existing' && currentBatchId) {
        await doUploadToBatch(currentBatchId, files);
      } else if (uploadTarget.current === 'new' && batchNameRef.current) {
        await doCreateAndUpload(batchNameRef.current, files);
      }
    } catch {
      alert('上传失败');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDelete = async () => {
    if (!currentBatchId) return;
    const batch = batches.find(b => b.id === currentBatchId);
    if (!batch) return;
    if (!confirm(`确认删除批次「${batch.name}」？\n未标注的批次将被删除，已标注的批次无法删除。`)) return;
    try {
      await doDeleteBatch(currentBatchId);
    } catch (err) {
      alert(err instanceof ApiError ? err.detail : '删除失败');
    }
  };

  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={currentBatchId ?? ''}
        onChange={(e) => { const id = Number(e.target.value); if (id) selectBatch(id); else deselectBatch(); }}
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
          {uploading ? '上传中...' : currentBatchId ? '补充上传' : '新建上传'}
        </button>
        {currentBatchId && (
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleDelete}>删除批次</button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/tiff" multiple
          onChange={handleFilesSelected} hidden />
      </div>
    </div>
  );
}
