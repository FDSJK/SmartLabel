import { useState, useEffect, useRef } from 'react';
import { fetchLabels, createLabel, updateLabel, deleteLabel, clearLabels, importLabelsTxt } from '../api/labels';
import type { Label } from '../types/api';
import { ApiError } from '../api/client';
import ColorPicker from '../components/common/ColorPicker';
import styles from './AdminLabelsPage.module.css';

export default function AdminLabelsPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try { setLabels(await fetchLabels()); } catch { setError('加载失败'); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await createLabel({ name: newName, color: '#3388ff' });
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '创建失败');
    }
  };

  const handleColor = async (label: Label, color: string) => {
    await updateLabel(label.id, { color });
    await load();
  };

  const handleDelete = async (label: Label) => {
    if (!confirm(`确定删除标签「${label.name}」？`)) return;
    await deleteLabel(label.id);
    await load();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importLabelsTxt(text);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '导入失败');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClearAll = async () => {
    if (!confirm('确定清空所有标签吗？此操作不可撤销！')) return;
    try {
      await clearLabels();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '清空失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>标签管理</h2>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={handleCreate}>
        <input className={styles.input} placeholder="标签名称" value={newName}
          onChange={e => setNewName(e.target.value)} required />
        <button className={styles.btn} type="submit">新建标签</button>
      </form>
      <div className={styles.importRow}>
        <button className={styles.btn} onClick={() => fileRef.current?.click()}>从 txt 文件导入</button>
        <button className={`${styles.btn} ${styles.btnClearAll}`} onClick={handleClearAll}>清空所有标签</button>
        <input ref={fileRef} type="file" accept=".txt" onChange={handleFileImport} hidden />
      </div>
      <table className={styles.table}>
        <thead>
          <tr><th>颜色</th><th>名称</th><th>操作</th></tr>
        </thead>
        <tbody>
          {labels.map(l => (
            <tr key={l.id}>
              <td><ColorPicker value={l.color} onChange={(c) => handleColor(l, c)} /></td>
              <td>{l.name}</td>
              <td>
                <button className={styles.btnDanger} onClick={() => handleDelete(l)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
