import { useState } from 'react';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { TriangleAlert } from 'lucide-react';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
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
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  getTenantsFindAllQueryKey,
  getTenantsFindOneQueryKey,
  useTenantsFindOne,
  useTenantsUpdate,
} from '../../../api/generated/api';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { formatDate } from '@saas-skeleton/ui/lib/format';
import { Fact } from '../components/fact';

/**
 * Картка тенанта — ЛЕЙАУТ маршруту `tenants/$tenantId` (той самий патерн, що картка
 * кастомера в tenant-web): шапка з ідентичністю, статусом і діями, рядок вкладок і
 * `<Outlet/>`. Вкладки — дочірні маршрути: «Overview» (`/`), «Access» (`access`) і
 * «Users» (`users`, аварійне керування юзерами tenant-а); справа — колонка стану
 *.
 *
 * Показуємо рівно те, що є в control plane: сам рядок тенанта і його наслідки для
 * входу. Стрічки подій тут НЕМАЄ навмисно — activities живуть у tenant-плані під
 * RLS, і платформа їх не читає; так само немає лічильника юзерів і джоб тенанта,
 * бо відповідних ендпоінтів у platform-api не існує.
 */
export function TenantDetailLayout() {
  const { t } = useTranslation('tenants');
  const { tenantId } = useParams({ from: '/app/tenants/$tenantId' });
  // Активна вкладка — перший сегмент шляху після картки (`/access`, `/users`); порожньо — огляд
  const activeTab = useRouterState({
    select: (state) => {
      const segment = state.location.pathname.split(`/tenants/${tenantId}`)[1]?.split('/')[1];
      return segment === undefined || segment === '' ? 'overview' : segment;
    },
  });
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

        <div className="flex items-center gap-2">
          <Button
            variant={tenant.isActive ? 'destructive' : 'default'}
            onClick={() => {
              setIsConfirmOpen(true);
            }}
          >
            {tenant.isActive ? t('actions.suspend') : t('actions.resume')}
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {/* Вкладки — дочірні маршрути: у кожної своя адреса, шапка не перемонтовується */}
          <Tabs value={activeTab}>
            <TabsList>
              <TabsTrigger
                value="overview"
                nativeButton={false}
                render={<Link to="/tenants/$tenantId" params={{ tenantId }} />}
              >
                {t('detail.tabs.overview')}
              </TabsTrigger>
              <TabsTrigger
                value="access"
                nativeButton={false}
                render={<Link to="/tenants/$tenantId/access" params={{ tenantId }} />}
              >
                {t('detail.tabs.access')}
              </TabsTrigger>
              <TabsTrigger
                value="users"
                nativeButton={false}
                render={<Link to="/tenants/$tenantId/users" params={{ tenantId }} />}
              >
                {t('detail.tabs.users')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Outlet />
        </div>

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
