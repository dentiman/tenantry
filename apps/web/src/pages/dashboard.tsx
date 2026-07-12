import { Card, Spinner } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useAuthMe } from '../api/generated/api';
import { formatDate } from '../lib/format';

export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { data: me, isLoading } = useAuthMe();

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={t('loadingLabel')} />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">{t('title')}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">{t('signedInAs')}</p>
          <p className="mt-1 truncate text-lg font-medium text-foreground">{me?.email}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">{t('role')}</p>
          <p className="mt-1 text-lg font-medium text-foreground">{me?.role}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs tracking-wide text-muted uppercase">{t('memberSince')}</p>
          <p className="mt-1 text-lg font-medium text-foreground">{formatDate(me?.createdAt)}</p>
        </Card>
      </div>
    </div>
  );
}
