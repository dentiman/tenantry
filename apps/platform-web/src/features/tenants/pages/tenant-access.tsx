import type { ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { useTenantsFindOne } from '../../../api/generated/api';

/** Пояснювальний блок вкладки Access: підпис, значення і чому це важливо */
function Note({ title, value, hint }: { title: string; value?: ReactNode; hint: string }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {value}
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Вкладка «Access» картки tenant-а: як юзери входять і що буде при suspend */
export function TenantAccessTab() {
  const { t } = useTranslation(['tenants']);
  const { tenantId } = useParams({ from: '/app/tenants/$tenantId' });
  const { data: tenant } = useTenantsFindOne(tenantId);
  if (!tenant) {
    return null;
  }

  return (
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.access.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Note
                  title={t('detail.access.organization')}
                  value={<code className="font-mono text-xs">{tenant.slug}</code>}
                  hint={t('detail.access.organizationHint')}
                />
                <Separator />
                <Note
                  title={t('detail.access.suspended')}
                  hint={t('detail.access.suspendedHint')}
                />
                <Separator />
                <Note title={t('detail.access.admin')} hint={t('detail.access.adminHint')} />
              </CardContent>
            </Card>);
}
