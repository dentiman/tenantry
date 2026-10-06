import { useState, type ReactNode } from 'react';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { TriangleAlert } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  getTenantsFindAllQueryKey,
  getTenantsFindOneQueryKey,
  useTenantsFindOne,
  useTenantsUpdate,
} from '../../../api/generated/api';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';

/** Рядок «підпис → значення»: та сама форма, що на картці юзера в apps/web */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

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

/**
 * Картка тенанта — та сама розкладка, що `/users/$userId` у tenant-адмінці:
 * шапка з ідентичністю, статусом і діями, під нею вкладки і вузька колонка стану.
 *
 * Показуємо рівно те, що є в control plane: сам рядок тенанта і його наслідки для
 * входу. Стрічки подій тут НЕМАЄ навмисно — activities живуть у tenant-плані під
 * RLS, і платформа їх не читає; так само немає лічильника юзерів і джоб тенанта,
 * бо відповідних ендпоінтів у platform-api не існує.
 */
export function TenantDetailPage() {
  const { t } = useTranslation('tenants');
  const { tenantId } = useParams({ from: '/app/tenants/$tenantId' });
  const queryClient = useQueryClient();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { data: tenant, isLoading, isError } = useTenantsFindOne(tenantId);
  const updateTenant = useTenantsUpdate({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getTenantsFindAllQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getTenantsFindOneQueryKey(tenantId) });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={t('loadingLabel')} />
      </div>
    );
  }

  if (isError || !tenant) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('detail.notFound')}</EmptyTitle>
          <EmptyDescription>{t('detail.notFoundHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const confirmKey = tenant.isActive ? 'actions.suspendConfirm' : 'actions.resumeConfirm';

  return (
    <div className="flex flex-col gap-6">
      {/* Крихти віддаються в хедер layout-а порталом (page-header-slot.tsx) */}
      <PageBreadcrumbs items={[{ label: t('title'), to: '/tenants' }, { label: tenant.name }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">{tenant.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{tenant.slug}</p>
          </div>
          <Badge variant={tenant.isActive ? 'success' : 'destructive'}>
            {tenant.isActive ? t('status.active') : t('status.suspended')}
          </Badge>
        </div>

        <Button
          variant={tenant.isActive ? 'destructive' : 'default'}
          onClick={() => {
            setIsConfirmOpen(true);
          }}
        >
          {tenant.isActive ? t('actions.suspend') : t('actions.resume')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Tabs defaultValue="overview" className="lg:col-span-2">
          <TabsList>
            <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
            <TabsTrigger value="access">{t('detail.tabs.access')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4">
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
          </TabsContent>

          <TabsContent value="access">
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
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('detail.state.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Fact label={t('detail.state.status')}>
              {tenant.isActive ? t('status.active') : t('status.suspended')}
            </Fact>
            <Separator />
            <Fact label={t('detail.state.since')}>{formatDate(tenant.createdAt)}</Fact>
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
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert className={tenant.isActive ? 'text-destructive' : 'text-primary'} />
            </AlertDialogMedia>
            <AlertDialogTitle>{t(`${confirmKey}.heading`)}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans t={t} i18nKey={`${confirmKey}.body`} values={{ name: tenant.name }} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t(`${confirmKey}.cancelLabel`)}</AlertDialogCancel>
            <AlertDialogAction
              variant={tenant.isActive ? 'destructive' : 'default'}
              onClick={() => {
                setIsConfirmOpen(false);
                updateTenant.mutate({ id: tenant.id, data: { isActive: !tenant.isActive } });
              }}
            >
              {t(`${confirmKey}.confirmLabel`)}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
