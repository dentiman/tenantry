import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { Ellipsis, TriangleAlert } from 'lucide-react';
import {
  getCustomersFindAllQueryKey,
  getCustomersFindOneQueryKey,
  useCustomersFindOne,
  useCustomersRemove,
  useCustomersRemoveContact,
  useCustomersSetStatus,
} from '../api/generated/api';
import type { CustomerDetailResponseDtoOutputContactsItem } from '../api/generated/model/customerDetailResponseDtoOutputContactsItem';
import { ActivityPanel } from '../components/activity/activity-panel';
import { CustomerContactModal } from '../components/customer-contact-modal';
import { CustomerIdentity } from '../components/customer-identity';
import { EditCustomerModal } from '../components/edit-customer-modal';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { CountryFlag } from '../components/form/phone/country-flag';
import { isSupportedCountry } from '../components/form/phone/countries';
import { formatForDisplay } from '../components/form/phone/phone-format';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';

type Contact = CustomerDetailResponseDtoOutputContactsItem;

/** Рядок «підпис → значення» у картках: одна форма на всі групи (як на /users/$userId) */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Картка кастомера. Розкладка навмисно та сама, що в `/users/$userId`: шапка з
 * ідентичністю і діями, вкладки з деталями/контактами/стрічкою, вузька колонка
 * стану. Форк, який додає свою сутність, копіює цей файл, а не вигадує розкладку.
 */
export function CustomerDetailPage() {
  const { t } = useTranslation(['customers']);
  const { customerId } = useParams({ from: '/app/customers/$customerId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [contactModal, setContactModal] = useState<{ isOpen: boolean; contact: Contact | null }>({
    isOpen: false,
    contact: null,
  });
  const [confirm, setConfirm] = useState<'archive' | 'delete' | Contact | null>(null);

  const { data: customer, isLoading, isError } = useCustomersFindOne(customerId);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getCustomersFindOneQueryKey(customerId) });
  };

  const setStatus = useCustomersSetStatus({ mutation: { onSuccess: invalidate } });
  const removeContact = useCustomersRemoveContact({ mutation: { onSuccess: invalidate } });
  const removeCustomer = useCustomersRemove({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
        void navigate({ to: '/customers' });
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

  const phone = formatForDisplay(customer.phone);
  const address = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.postalCode, customer.city].filter(Boolean).join(' '),
    customer.region,
    customer.country,
  ]
    .filter((part) => part && part.length > 0)
    .join(', ');

  const isDeleteConfirm = confirm === 'delete';
  const isArchiveConfirm = confirm === 'archive';
  const contactToDelete = typeof confirm === 'object' && confirm !== null ? confirm : null;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/customers' }, { label: customer.name }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* Та сама ідентичність, що в рядку гріда — інша тільки роль блоку:
              у шапці титул рівня сторінки, а під ним завжди номер (окремий
              mono-рядок над іменем прибрано — він і був цим другим рядком) */}
          <CustomerIdentity
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
        <Tabs defaultValue="overview" className="lg:col-span-2">
          <TabsList>
            <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
            <TabsTrigger value="contacts">{t('detail.tabs.contacts')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.state.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Fact label={t('detail.state.status')}>{t(`status.${customer.status}`)}</Fact>
                <Separator />
                <Fact label={t('detail.state.owner')}>
                  {customer.owner ? (
                    (customer.owner.name ?? customer.owner.email)
                  ) : (
                    <span className="text-muted-foreground">{t('owner.none')}</span>
                  )}
                </Fact>
                <Separator />
                <Fact label={t('detail.state.contacts')}>{customer.contactsCount}</Fact>
                <Separator />
                <Fact label={t('detail.state.customerSince')}>
                  {formatDate(customer.createdAt)}
                </Fact>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('detail.contact.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Fact label={t('detail.contact.email')}>
                  {customer.email ?? t('detail.contact.empty')}
                </Fact>
                <Separator />
                <Fact label={t('detail.contact.phone')}>
                  {phone ? (
                    <span className="flex items-center justify-end gap-2 tabular-nums">
                      {isSupportedCountry(customer.phoneCountry) && (
                        <CountryFlag country={customer.phoneCountry} />
                      )}
                      {phone}
                    </span>
                  ) : (
                    t('detail.contact.empty')
                  )}
                </Fact>
                <Separator />
                <Fact label={t('detail.contact.website')}>
                  {customer.website ?? t('detail.contact.empty')}
                </Fact>
                <Separator />
                <Fact label={t('detail.contact.address')}>
                  {address || t('detail.contact.empty')}
                </Fact>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('detail.business.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Fact label={t('detail.business.kind')}>{t(`kind.${customer.kind}`)}</Fact>
                <Separator />
                <Fact label={t('detail.business.legalName')}>
                  {customer.legalName ?? t('detail.contact.empty')}
                </Fact>
                <Separator />
                <Fact label={t('detail.business.taxId')}>
                  {customer.taxId ?? t('detail.contact.empty')}
                </Fact>
                <Separator />
                <Fact label={t('detail.business.currency')}>{customer.currency}</Fact>
                <Separator />
                <Fact label={t('detail.business.externalId')}>
                  {customer.externalId ?? t('detail.contact.empty')}
                </Fact>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('detail.tags.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {customer.tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('detail.tags.empty')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {customer.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('detail.notes.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {customer.notes ? (
                  <p className="text-sm whitespace-pre-wrap text-foreground">{customer.notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('detail.notes.empty')}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('detail.meta.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Fact label={t('detail.meta.created')}>{formatDateTime(customer.createdAt)}</Fact>
                <Separator />
                <Fact label={t('detail.meta.updated')}>{formatDateTime(customer.updatedAt)}</Fact>
                <Separator />
                <Fact label={t('detail.meta.id')}>
                  <code className="font-mono text-xs break-all">{customer.id}</code>
                </Fact>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{t('contacts.title')}</CardTitle>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setContactModal({ isOpen: true, contact: null });
                  }}
                >
                  {t('contacts.add')}
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {customer.contacts.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>{t('contacts.empty')}</EmptyTitle>
                      <EmptyDescription>{t('contacts.emptyHint')}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  customer.contacts.map((contact) => (
                    <Item key={contact.id} variant="outline">
                      <ItemContent>
                        <ItemTitle className="flex items-center gap-2">
                          {contact.name}
                          {contact.isPrimary && (
                            <Badge variant="secondary">{t('contacts.primary')}</Badge>
                          )}
                        </ItemTitle>
                        {/* ItemDescription уже є <p> — власного абзацу всередині не кладемо */}
                        <ItemDescription>
                          {[contact.position, contact.email, formatForDisplay(contact.phone)]
                            .filter(Boolean)
                            .join(' · ') || t('detail.contact.empty')}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            aria-label={t('contacts.rowActions')}
                          >
                            <Ellipsis />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setContactModal({ isOpen: true, contact });
                              }}
                            >
                              {t('contacts.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setConfirm(contact);
                              }}
                            >
                              {t('contacts.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ItemActions>
                    </Item>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

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

      <CustomerContactModal
        customerId={customer.id}
        contact={contactModal.contact}
        isOpen={contactModal.isOpen}
        onClose={() => {
          setContactModal({ isOpen: false, contact: null });
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
              {isDeleteConfirm
                ? t('delete.heading')
                : isArchiveConfirm
                  ? t('status.archiveHeading')
                  : t('contacts.deleteHeading')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey={
                  isDeleteConfirm
                    ? 'delete.body'
                    : isArchiveConfirm
                      ? 'status.archiveBody'
                      : 'contacts.deleteBody'
                }
                values={{ name: contactToDelete ? contactToDelete.name : customer.name }}
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
                } else if (isArchiveConfirm) {
                  setStatus.mutate({ id: customer.id, data: { status: 'ARCHIVED' } });
                } else if (contactToDelete) {
                  removeContact.mutate({ id: customer.id, contactId: contactToDelete.id });
                }
                setConfirm(null);
              }}
            >
              {isDeleteConfirm
                ? t('delete.confirm')
                : isArchiveConfirm
                  ? t('status.archiveConfirm')
                  : t('contacts.deleteConfirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
