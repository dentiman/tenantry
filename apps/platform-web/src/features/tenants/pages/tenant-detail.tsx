import { useState } from 'react';
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  getTenantsFindAllQueryKey,
  getTenantsFindOneQueryKey,
  useTenantActivitiesFindAll,
  useTenantsFindOne,
  useTenantsUpdate,
} from '../../../api/generated/api';
import { ActivityPanel } from '@saas-skeleton/ui/activities';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';

/**
 * Картка тенанта — ЛЕЙАУТ маршруту `tenants/$tenantId` (той самий патерн, що картка
 * кастомера в tenant-web): шапка з ідентичністю, статусом і діями, рядок вкладок і
 * `<Outlet/>`. Вкладки — дочірні маршрути: «Overview» (`/`), «Access» (`access`) і
 * «Users» (`users`, аварійне керування юзерами tenant-а); справа — стрічка подій усього
 * тенанта (стан і дозволи — у вкладці Overview).
 *
 * Стрічку платформа читає з tenant-ових `activities` через system-клієнт з явним
 * `tenantId` (`GET /tenants/:id/activities`): це операційний зріз для оператора, і він
 * бачить усі типи, більше за будь-якого юзера тенанта. Лічильника юзерів і джоб
 * тенанта немає, бо відповідних ендпоінтів у platform-api не існує.
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

        {/* Стрічка подій УСЬОГО тенанта — операційний зріз для розбору інцидентів: усі
            юзери, усі сутності, усі типи (docs/activity-log.md). Той самий компонент, що
            на картці кастомера в tenant-web; джерело — platform-api */}
        <ActivityPanel
          feedKey={`tenant:${tenantId}`}
          useFeedQuery={({ cursor, isEnabled }) =>
            useTenantActivitiesFindAll(tenantId, { cursor }, { query: { enabled: isEnabled } })
          }
        />
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
