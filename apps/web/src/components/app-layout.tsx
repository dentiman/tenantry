import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/auth.store';

const navLinkClass = 'rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100';
const activeProps = { className: `${navLinkClass} bg-gray-100 text-gray-900` };

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  const logout = () => {
    clearSession();
    void navigate({ to: '/login' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-indigo-600">SaaS Skeleton</span>
            <nav className="flex gap-1">
              <Link
                to="/"
                className={navLinkClass}
                activeProps={activeProps}
                activeOptions={{ exact: true }}
              >
                Dashboard
              </Link>
              <Link to="/users" className={navLinkClass} activeProps={activeProps}>
                Users
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user?.email}</span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
