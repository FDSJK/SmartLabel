import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AnnotationPage from './pages/AnnotationPage';
import StatsPage from './pages/StatsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminLabelsPage from './pages/AdminLabelsPage';
import MySettingsPage from './pages/MySettingsPage';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/common/Layout';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<AnnotationPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/labels" element={<AdminLabelsPage />} />
          <Route path="/settings" element={<MySettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
