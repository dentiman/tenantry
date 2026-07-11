import { useAuthMe } from '../api/generated/api';

export function DashboardPage() {
  const { data: me, isLoading } = useAuthMe();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Signed in as</p>
          <p className="mt-1 truncate text-lg font-medium text-gray-900">{me?.email}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Role</p>
          <p className="mt-1 text-lg font-medium text-gray-900">{me?.role}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Member since</p>
          <p className="mt-1 text-lg font-medium text-gray-900">
            {me ? new Date(me.createdAt).toLocaleDateString() : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
