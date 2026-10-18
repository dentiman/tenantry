import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import type { TenantResponseDtoOutput } from '../../../api/generated/model';
import {
  getTenantsFindAllQueryKey,
  getTenantsFindOneQueryKey,
  useTenantsUpdate,
} from '../../../api/generated/api';
import { Fact } from './fact';

/**
 * Стан тенанта і дозволи платформи. Раніше стояв у правій колонці картки; з 2026-10-18
 * колонку займає стрічка подій тенанта, а стан переїхав у вкладку Overview.
 */
export function TenantStateCard({ tenant }: { tenant: TenantResponseDtoOutput }) {
  const { t } = useTranslation('tenants');
  const queryClient = useQueryClient();
  const updateTenant = useTenantsUpdate({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getTenantsFindAllQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getTenantsFindOneQueryKey(tenant.id) });
      },
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.state.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Fact label={t('detail.state.status')}>
          {tenant.isActive ? t('status.active') : t('status.suspended')}
        </Fact>
        <Separator />
        {/* Дозвіл платформи (AI-5a): Tenant Admin вмикає асистента лише в його межах */}
        <Field orientation="horizontal" className="py-1.5">
          <FieldContent>
            <FieldLabel htmlFor="tenant-ai-allowed">{t('detail.state.ai')}</FieldLabel>
            <FieldDescription>{t('detail.state.aiHint')}</FieldDescription>
          </FieldContent>
          <Switch
            id="tenant-ai-allowed"
            checked={tenant.aiAllowed}
            disabled={updateTenant.isPending}
            onCheckedChange={(checked) => {
              updateTenant.mutate({ id: tenant.id, data: { aiAllowed: checked } });
            }}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
