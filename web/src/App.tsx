import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuthStore } from './features/auth/authStore';
import { DASHBOARD_PATH } from './features/auth/roles';
import { useRestoreSession } from './features/auth/useRestoreSession';
import { AdminDashboard } from './pages/AdminDashboard';
import { DeveloperDashboard } from './pages/DeveloperDashboard';
import { LoginPage } from './pages/LoginPage';
import { PmDashboard } from './pages/PmDashboard';

/** "/" and unknown paths: the signed-in user's own dashboard. */
function HomeRedirect() {
  const role = useAuthStore((state) => state.user?.role);
  return role ? <Navigate to={DASHBOARD_PATH[role]} replace /> : null;
}

export default function App() {
  useRestoreSession();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Any signed-in user gets the layout; each dashboard is then limited to its own role. */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={['ADMIN']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pm"
            element={
              <ProtectedRoute allow={['PROJECT_MANAGER']}>
                <PmDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/developer"
            element={
              <ProtectedRoute allow={['DEVELOPER']}>
                <DeveloperDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
