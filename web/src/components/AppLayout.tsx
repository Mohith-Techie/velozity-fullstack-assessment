import { Link, Outlet } from 'react-router-dom';
import { logout } from '../api/auth';
import { useAuthStore } from '../features/auth/authStore';
import { DASHBOARD_PATH, ROLE_LABEL } from '../features/auth/roles';
import { NotificationBadge } from '../features/notifications/NotificationBadge';
import { SocketProvider } from '../realtime/SocketProvider';

/** Shell for signed-in pages. Rendered inside ProtectedRoute, so a user is always present. */
export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  if (!user) return null;

  return (
    // One shared real-time connection for everything below: the navbar badge and the activity feed.
    <SocketProvider>
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link to={DASHBOARD_PATH[user.role]} className="font-semibold">
              PM Dashboard
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <NotificationBadge />
              <span className="text-slate-600">{user.name}</span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                {ROLE_LABEL[user.role]}
              </span>
              {/* Clearing the session makes ProtectedRoute redirect to /login. */}
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    </SocketProvider>
  );
}
