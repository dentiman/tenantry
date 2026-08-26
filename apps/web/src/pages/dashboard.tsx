import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { useAuthMe } from '../api/generated/api';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { formatDate } from '@saas-skeleton/ui/lib/format';

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

  const cards = [
    { label: t('signedInAs'), value: me?.email, truncate: true },
    { label: t('role'), value: me?.role, truncate: false },
    { label: t('memberSince'), value: formatDate(me?.createdAt), truncate: false },
  ];

  return (
    <div>
      <PageBreadcrumbs items={[{ label: t('title') }]} />
      <h1 className="mb-6 text-2xl font-semibold text-foreground">{t('title')}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">{card.label}</p>
              <p
                className={`mt-1 text-lg font-medium text-foreground${card.truncate ? ' truncate' : ''}`}
              >
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
