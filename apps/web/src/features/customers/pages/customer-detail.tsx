import { useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
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
import { TriangleAlert } from 'lucide-react';
import {
  getCustomersFindAllQueryKey,
  getCustomersFindOneQueryKey,
  useCustomersFindOne,
  useCustomersRemove,
  useCustomersSetStatus,
} from '../../../api/generated/api';
import { ActivityPanel } from '../../activities/components/activity-panel';
import { customerDetailTabs } from '../customer-detail-slots';
import { SlotOutlet } from '../../../lib/slots';
import { CustomerIdentity } from '../components/customer-identity';
import { EditCustomerModal } from '../components/edit-customer-modal';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';

/**
 * Картка кастомера — ЛЕЙАУТ маршруту `customers/$customerId`: шапка з ідентичністю і діями,
 * рядок вкладок і `<Outlet/>` для них, справа — стрічка подій. Вкладки — дочірні маршрути:
 * «Огляд» (`/`), «Контакти» (`contacts`) і вкладки фіч, що чіпляються сюди своїми маршрутами
 * та внеском у слот `customerDetailTabs` (календар → `events`; docs/modules.md §7.4).
 * Форк, який додає свою сутність, копіює цей лейаут, а не вигадує розкладку.
 */
export function CustomerDetailLayout() {
  const { t } = useTranslation(['customers']);
  const { customerId } = useParams({ from: '/app/workspace/customers/$customerId' });
  // Активна вкладка — перший сегмент шляху після картки (`/contacts`, `/events`); порожньо — огляд
  const activeTab = useRouterState({
    select: (state) => {
      const segment = state.location.pathname.split(`/customers/${customerId}`)[1]?.split('/')[1];
      return segment === undefined || segment === '' ? 'overview' : segment;
    },
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const { data: customer, isLoading, isError } = useCustomersFindOne(customerId);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getCustomersFindOneQueryKey(customerId) });
  };

  const setStatus = useCustomersSetStatus({ mutation: { onSuccess: invalidate } });
  const removeCustomer = useCustomersRemove({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
        void navigate({ to: '/workspace/customers' });
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

  if (isError || !customer) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('detail.notFound')}</EmptyTitle>
          <EmptyDescription>{t('detail.notFoundHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const isDeleteConfirm = confirm === 'delete';
  const isArchiveConfirm = confirm === 'archive';

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/workspace/customers' }, { label: customer.name }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* Та сама ідентичність, що в рядку гріда — інша тільки роль блоку:
              у шапці титул рівня сторінки, а під ним завжди номер (окремий
              mono-рядок над іменем прибрано — він і був цим другим рядком) */}
          <CustomerIdentity
            id={customer.id}
            kind={customer.kind}
            name={customer.name}
            numberLabel={customer.numberLabel}
            variant="header"
            size="lg"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                customer.status === 'ACTIVE'
                  ? 'success'
                  : customer.status === 'INACTIVE'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {t(`status.${customer.status}`)}
            </Badge>
            {/* Бейджа типу немає: у шапці його несе форма медіа (як у гріді),
                а словом він названий фактом «Type» у вкладці Overview */}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setIsEditOpen(true);
            }}
          >
            {t('detail.edit')}
          </Button>
          {customer.status === 'ARCHIVED' ? (
            <Button
              variant="secondary"
              onClick={() => {
                setStatus.mutate({ id: customer.id, data: { status: 'ACTIVE' } });
              }}
            >
              {t('status.restoreAction')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm('archive');
              }}
            >
              {t('status.archiveAction')}
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => {
              setConfirm('delete');
            }}
          >
            {t('delete.button')}
          </Button>
        </div>
      </div>

      {/* Дві колонки: зліва дані сутності, справа — постійна стрічка подій.
          Вкладки лишились, бо контактні особи — окремий розділ, а не блок */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {/* Вкладки — дочірні маршрути (docs/modules.md §7.4): у кожної своя
              адреса, шапка не перемонтовується. Власні вкладки кастомера — тут, вкладки
              фіч (календар → «Події») — внески в слот `customerDetailTabs` */}
          <Tabs value={activeTab}>
            <TabsList>
              <TabsTrigger
                value="overview"
                nativeButton={false}
                render={<Link to="/workspace/customers/$customerId" params={{ customerId }} />}
              >
                {t('detail.tabs.overview')}
              </TabsTrigger>
              <TabsTrigger
                value="contacts"
                nativeButton={false}
                render={
                  <Link to="/workspace/customers/$customerId/contacts" params={{ customerId }} />
                }
              >
                {t('detail.tabs.contacts')}
              </TabsTrigger>
              <SlotOutlet slot={customerDetailTabs} props={{ customerId }} />
            </TabsList>
          </Tabs>
          <Outlet />
        </div>

        {/* Той самий компонент, що на картці юзера: фід сутності generic від
            першого дня, нового ендпоінта під кастомерів не знадобилось */}
        <ActivityPanel entityType="customer" entityId={customer.id} />
      </div>

      <EditCustomerModal
        customer={isEditOpen ? customer : null}
        onClose={() => {
          setIsEditOpen(false);
        }}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {isDeleteConfirm ? t('delete.heading') : t('status.archiveHeading')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey={isDeleteConfirm ? 'delete.body' : 'status.archiveBody'}
                values={{ name: customer.name }}
                components={{ strong: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>
              {isDeleteConfirm ? t('delete.cancel') : t('status.archiveCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={isArchiveConfirm ? undefined : 'destructive'}
              onClick={() => {
                if (isDeleteConfirm) {
                  removeCustomer.mutate({ id: customer.id });
                } else {
                  setStatus.mutate({ id: customer.id, data: { status: 'ARCHIVED' } });
                }
                setConfirm(null);
              }}
            >
              {isDeleteConfirm ? t('delete.confirm') : t('status.archiveConfirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
