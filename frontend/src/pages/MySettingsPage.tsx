import { useState, useEffect } from 'react';
import { fetchMe, updateMyWorkDir } from '../api/users';
import { ApiError } from '../api/client';
import styles from './MySettingsPage.module.css';

export default function MySettingsPage() {
  const [workDir, setWorkDir] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMe().then(u => setWorkDir(u.work_dir ?? '')).catch(() => {});
  }, []);

  const handleSave = async () => {
    setError(''); setSaved(false);
    try {
      await updateMyWorkDir(workDir);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '保存失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>我的设置</h2>
      {error && <div className={styles.error}>{error}</div>}
      {saved && <div className={styles.success}>已保存</div>}
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
