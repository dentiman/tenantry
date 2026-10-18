import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { useTenantsFindOne } from '../../../api/generated/api';
import { Fact } from '../components/fact';
import { TenantStateCard } from '../components/tenant-state-card';

/**
 * Вкладка «Overview» картки tenant-а — індексний дочірній маршрут `TenantDetailLayout`.
 * Tenant-а бере з того самого кешу запитів, що й лейаут: окремого запиту немає.
 */
export function TenantOverviewTab() {
  const { t } = useTranslation(['tenants']);
  const { tenantId } = useParams({ from: '/app/tenants/$tenantId' });
  const { data: tenant } = useTenantsFindOne(tenantId);
  // Завантаження і «не знайдено» показує лейаут — сюди без tenant-а не доходить
  if (!tenant) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <TenantStateCard tenant={tenant} />

  <Card>
    <CardHeader>
      <CardTitle>{t('detail.identity.title')}</CardTitle>
    </CardHeader>
    <CardContent>
      <Fact label={t('detail.identity.name')}>{tenant.name}</Fact>
      <Separator />
      <Fact label={t('detail.identity.slug')}>
        <code className="font-mono text-xs">{tenant.slug}</code>
      </Fact>
      <Separator />
      <Fact label={t('detail.identity.locale')}>{tenant.locale}</Fact>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>{t('detail.record.title')}</CardTitle>
    </CardHeader>
    <CardContent>
      <Fact label={t('detail.record.created')}>{formatDateTime(tenant.createdAt)}</Fact>
      <Separator />
      <Fact label={t('detail.record.updated')}>{formatDateTime(tenant.updatedAt)}</Fact>
      <Separator />
      <Fact label={t('detail.record.id')}>
        <code className="font-mono text-xs break-all">{tenant.id}</code>
      </Fact>
    </CardContent>
  </Card>
    </div>
  );
}
