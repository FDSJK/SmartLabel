import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import styles from './Layout.module.css';

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>灵标</Link>
        <nav className={styles.nav}>
          <Link to="/">标注</Link>
          <Link to="/stats">统计</Link>
          {user?.role === 'admin' && (
            <>
              <Link to="/admin/users">用户管理</Link>
              <Link to="/admin/labels">标签管理</Link>
              <Link to="/admin/settings">系统设置</Link>
            </>
          )}
        </nav>
        <div className={styles.user}>
          <span>{user?.username}</span>
          <button onClick={handleLogout}>退出</button>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
