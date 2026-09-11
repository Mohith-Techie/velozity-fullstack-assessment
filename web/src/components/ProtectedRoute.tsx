import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore, type Role } from '../features/auth/authStore';
import { DASHBOARD_PATH } from '../features/auth/roles';
import { FullPageSpinner } from './FullPageSpinner';

interface ProtectedRouteProps {
  /** Roles allowed through. Omit to allow any signed-in user. */
  allow?: readonly Role[];
  /** Rendered when allowed; defaults to the nested routes (<Outlet />). */
  children?: ReactNode;
}

/**
 * Decides what to render; the API still enforces every rule on its own.
 *  - session still being restored → spinner (no flash of the login page on reload);
 *  - signed out → /login, remembering where the user was headed;
 *  - signed in with the wrong role (e.g. a developer opening /pm) → that user's own dashboard.
 */
export function ProtectedRoute({ allow, children }: ProtectedRouteProps) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === 'checking') return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (allow && !allow.includes(user.role)) return <Navigate to={DASHBOARD_PATH[user.role]} replace />;
  return children ?? <Outlet />;
}
