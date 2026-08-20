import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMe, updateMyWorkDir } from '../api/users';
import { useBatchStore } from '../stores/batchStore';
import { ApiError } from '../api/client';
import styles from './MySettingsPage.module.css';

export default function MySettingsPage() {
  const [workDir, setWorkDir] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchMe().then(u => setWorkDir(u.work_dir ?? '')).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError('');
    try {
      await updateMyWorkDir(workDir);
      // 工作目录已切换：清空当前选中，回到标注页刷新批次列表
      useBatchStore.getState().deselectBatch();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>我的设置</h2>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.field}>
        <label className={styles.label}>我的工作目录（数据根目录）</label>
        <input className={styles.input} value={workDir}
          onChange={e => setWorkDir(e.target.value)}
          placeholder="/path/to/my/data" />
        <p className={styles.hint}>图像批次将存放在此目录下的 batches/ 子目录中（仅本人可见）</p>
      </div>
      <button className={styles.btn} onClick={handleSave}>保存设置</button>
    </div>
  );
}
