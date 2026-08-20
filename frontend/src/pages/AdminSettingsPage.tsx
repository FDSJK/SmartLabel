import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSettings, updateSetting } from '../api/settings';
import { useBatchStore } from '../stores/batchStore';
import { useImageStore } from '../stores/imageStore';
import { ApiError } from '../api/client';
import styles from './AdminSettingsPage.module.css';

export default function AdminSettingsPage() {
  const [workDir, setWorkDir] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchSettings().then(s => { if (s.WORK_DIR) setWorkDir(s.WORK_DIR); }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError('');
    try {
      await updateSetting('WORK_DIR', workDir);
      // 工作目录已切换：清空批次、图像列表和画布，回到标注页刷新
      useBatchStore.getState().deselectBatch();
      useImageStore.getState().clearImage();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>应用设置</h2>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.field}>
        <label className={styles.label}>工作目录（数据根目录）</label>
        <input className={styles.input} value={workDir}
          onChange={e => setWorkDir(e.target.value)}
          placeholder="/path/to/data" />
        <p className={styles.hint}>图像批次将存放在此目录下的 batches/ 子目录中</p>
      </div>
      <button className={styles.btn} onClick={handleSave}>保存设置</button>
    </div>
  );
}
