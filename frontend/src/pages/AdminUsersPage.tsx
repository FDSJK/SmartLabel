import { useState, useEffect } from 'react';
import { fetchUsers, createUser, updateUser, deleteUser } from '../api/users';
import type { User } from '../types/api';
import { ApiError } from '../api/client';
import styles from './AdminUsersPage.module.css';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'annotator' });
  const [error, setError] = useState('');

  const load = async () => {
    try { setUsers(await fetchUsers()); } catch { setError('加载失败'); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await createUser(newUser);
      setNewUser({ username: '', password: '', role: 'annotator' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '创建失败');
    }
  };

  const handleToggle = async (user: User) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      await load();
    } catch { setError('操作失败'); }
  };

  const handleResetPw = async (user: User) => {
    const pw = prompt(`为 ${user.username} 设置新密码（至少4位）：`);
    if (!pw) return;
    try {
      await updateUser(user.id, { password: pw });
    } catch { setError('密码重置失败'); }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`确认删除用户「${user.username}」？此操作不可撤销。`)) return;
    try {
      await deleteUser(user.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '删除失败');
    }
  };

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>用户管理</h2>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={handleCreate}>
        <input className={styles.input} placeholder="用户名" value={newUser.username}
          onChange={e => setNewUser({...newUser, username: e.target.value})} required />
        <input className={styles.input} type="password" placeholder="密码" value={newUser.password}
          onChange={e => setNewUser({...newUser, password: e.target.value})} required minLength={4} />
        <select className={styles.input} value={newUser.role}
          onChange={e => setNewUser({...newUser, role: e.target.value})}>
          <option value="annotator">标注员</option>
          <option value="admin">管理员</option>
        </select>
        <button className={styles.btn} type="submit">创建账号</button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.role === 'admin' ? '管理员' : '标注员'}</td>
              <td>{u.is_active ? '启用' : '禁用'}</td>
              <td>{new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
              <td className={styles.actions}>
                <button className={styles.btnSmall} onClick={() => handleToggle(u)}>
                  {u.is_active ? '禁用' : '启用'}
                </button>
                <button className={styles.btnSmall} onClick={() => handleResetPw(u)}>改密</button>
                <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => handleDelete(u)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
