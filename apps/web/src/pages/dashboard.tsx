import { Card, Spinner } from '@heroui/react';
import { useAuthMe } from '../api/generated/api';

export function DashboardPage() {
  const { data: me, isLoading } = useAuthMe();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">Signed in as</p>
          <p className="mt-1 truncate text-lg font-medium text-foreground">{me?.email}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">Role</p>
          <p className="mt-1 text-lg font-medium text-foreground">{me?.role}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">Member since</p>
          <p className="mt-1 text-lg font-medium text-foreground">
            {me ? new Date(me.createdAt).toLocaleDateString() : '—'}
          </p>
        </Card>
      </div>
    </div>
  );
}
