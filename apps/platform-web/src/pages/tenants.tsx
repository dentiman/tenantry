import { useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getTenantsFindAllQueryKey,
  useTenantsFindAll,
  useTenantsUpdate,
} from '../api/generated/api';
import type { TenantResponseDtoOutput } from '../api/generated/model/tenantResponseDtoOutput';
import { CreateTenantModal } from '../components/create-tenant-modal';
import { formatDate } from '../lib/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader } from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';

const COLUMN_COUNT = 5;

/**
 * MT-3: CRUD тенантів — єдине місце в системі, де тенант створюється/suspend-иться
 * (у tenant-api під RLS це структурно неможливо). Плоска таблиця без DataGrid-фреймворку:
 * GET /tenants не приймає пагінацію/фільтри (адмінський список, не очікується сотень
 * рядків) — заводити фейкову route-search-схему заради переюзання гріда було б зайвим.
 */
export function TenantsPage() {
  const { t } = useTranslation(['tenants', 'common']);
  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useTenantsFindAll({
    query: { placeholderData: (prev) => prev },
  });
  const items = data?.items ?? [];

  const updateTenant = useTenantsUpdate();
  const [pending, setPending] = useState<TenantResponseDtoOutput | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getTenantsFindAllQueryKey() });
  };

  const toggleActive = async (tenant: TenantResponseDtoOutput): Promise<void> => {
    await updateTenant.mutateAsync({
      id: tenant.id,
      data: { isActive: !tenant.isActive },
    });
    invalidate();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <CreateTenantModal />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label={t('loadingLabel')} />
        </div>
      ) : (
        <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table aria-label={t('table.ariaLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.slug')}</TableHead>
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead>{t('table.status')}</TableHead>
                  <TableHead>{t('table.created')}</TableHead>
                  <TableHead aria-label={t('actions.menu')} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLUMN_COUNT}>
                      <Empty className="border-0">
                        <EmptyHeader>
                          <EmptyDescription>{t('empty')}</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium text-foreground">{tenant.slug}</TableCell>
                      <TableCell>{tenant.name}</TableCell>
                      <TableCell>
                        <Badge variant={tenant.isActive ? 'success' : 'destructive'}>
                          {tenant.isActive ? t('status.active') : t('status.suspended')}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(tenant.createdAt)}</TableCell>
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPending(tenant);
                          }}
                        >
                          {tenant.isActive ? t('actions.suspend') : t('actions.resume')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              {pending?.isActive ? (
                <TriangleAlert className="text-destructive" />
              ) : (
                <CircleCheck className="text-primary" />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {pending?.isActive
                ? t('actions.suspendConfirm.heading')
                : t('actions.resumeConfirm.heading')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                (pending.isActive
                  ? t('actions.suspendConfirm.body', { name: pending.name })
                  : t('actions.resumeConfirm.body', { name: pending.name }))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {pending?.isActive
                ? t('actions.suspendConfirm.cancelLabel')
                : t('actions.resumeConfirm.cancelLabel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.isActive ? 'destructive' : 'default'}
              onClick={() => {
                if (pending) {
                  const tenant = pending;
                  setPending(null);
                  void toggleActive(tenant);
                }
              }}
            >
              {pending?.isActive
                ? t('actions.suspendConfirm.confirmLabel')
                : t('actions.resumeConfirm.confirmLabel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
