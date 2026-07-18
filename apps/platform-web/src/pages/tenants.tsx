import { useState } from 'react';
import { AlertDialog, Button, Chip, EmptyState, Spinner, Table } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getTenantsFindAllQueryKey, useTenantsFindAll, useTenantsUpdate } from '../api/generated/api';
import type { TenantResponseDtoOutput } from '../api/generated/model/tenantResponseDtoOutput';
import { CreateTenantModal } from '../components/create-tenant-modal';
import { formatDate } from '../lib/format';

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
    setPending(null);
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
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={t('table.ariaLabel')}>
                <Table.Header>
                  <Table.Column isRowHeader>{t('table.slug')}</Table.Column>
                  <Table.Column>{t('table.name')}</Table.Column>
                  <Table.Column>{t('table.status')}</Table.Column>
                  <Table.Column>{t('table.created')}</Table.Column>
                  <Table.Column aria-label={t('actions.menu')}> </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex h-full w-full flex-col items-center justify-center gap-2 py-6 text-center">
                      <span className="text-sm text-muted">{t('empty')}</span>
                    </EmptyState>
                  )}
                >
                  {items.map((tenant) => (
                    <Table.Row key={tenant.id} id={tenant.id}>
                      <Table.Cell className="font-medium text-foreground">{tenant.slug}</Table.Cell>
                      <Table.Cell>{tenant.name}</Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" color={tenant.isActive ? 'success' : 'danger'}>
                          {tenant.isActive ? t('status.active') : t('status.suspended')}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>{formatDate(tenant.createdAt)}</Table.Cell>
                      <Table.Cell className="text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            setPending(tenant);
                          }}
                        >
                          {tenant.isActive ? t('actions.suspend') : t('actions.resume')}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>
      )}

      <AlertDialog.Backdrop
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status={pending?.isActive ? 'danger' : 'accent'} />
              <AlertDialog.Heading>
                {pending?.isActive ? t('actions.suspendConfirm.heading') : t('actions.resumeConfirm.heading')}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {pending &&
                (pending.isActive
                  ? t('actions.suspendConfirm.body', { name: pending.name })
                  : t('actions.resumeConfirm.body', { name: pending.name }))}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {pending?.isActive
                  ? t('actions.suspendConfirm.cancelLabel')
                  : t('actions.resumeConfirm.cancelLabel')}
              </Button>
              <Button
                slot="close"
                variant={pending?.isActive ? 'danger' : 'primary'}
                onPress={() => {
                  if (pending) {
                    void toggleActive(pending);
                  }
                }}
              >
                {pending?.isActive
                  ? t('actions.suspendConfirm.confirmLabel')
                  : t('actions.resumeConfirm.confirmLabel')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
