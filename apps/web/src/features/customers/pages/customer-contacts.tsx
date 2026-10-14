import { useState } from 'react';
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
import { Ellipsis, TriangleAlert } from 'lucide-react';
import {
  getCustomersFindAllQueryKey,
  getCustomersFindOneQueryKey,
  useCustomersFindOne,
  useCustomersRemoveContact,
} from '../../../api/generated/api';
import type { CustomerDetailResponseDtoOutputContactsItem } from '../../../api/generated/model/customerDetailResponseDtoOutputContactsItem';
import { formatForDisplay } from '../../../components/form/phone/phone-format';
import { CustomerContactModal } from '../components/customer-contact-modal';

type Contact = CustomerDetailResponseDtoOutputContactsItem;

/**
 * Вкладка «Контакти» картки кастомера — дочірній маршрут `contacts` лейаута
 * `CustomerDetailLayout`: контактні особи — окремий розділ, а не блок, тож і своя адреса.
 * Додавання, редагування й видалення контакту живуть тут, а не в лейауті.
 */
export function CustomerContactsTab() {
  const { t } = useTranslation(['customers']);
  const { customerId } = useParams({ from: '/app/workspace/customers/$customerId' });
  const queryClient = useQueryClient();
  const [contactModal, setContactModal] = useState<{ isOpen: boolean; contact: Contact | null }>({
    isOpen: false,
    contact: null,
  });
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);

  const { data: customer } = useCustomersFindOne(customerId);
  const removeContact = useCustomersRemoveContact({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getCustomersFindOneQueryKey(customerId) });
      },
    },
  });
  // Завантаження і «не знайдено» показує лейаут — сюди без кастомера не доходить
  if (!customer) {
    return null;
  }

  return (
    <>
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
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex items-center gap-2">
                    {contact.name}
                    {contact.isPrimary && (
                      <Badge variant="secondary">{t('contacts.primary')}</Badge>
                    )}
                  </ItemTitle>
                  {/* ItemDescription уже є <p> — власного абзацу всередині не кладемо */}
                  {/* break-all: email без пробілів інакше виштовхує ItemActions за край рядка */}
                  <ItemDescription className="break-all">
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
                          setContactToDelete(contact);
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

      <CustomerContactModal
        customerId={customer.id}
        contact={contactModal.contact}
        isOpen={contactModal.isOpen}
        onClose={() => {
          setContactModal({ isOpen: false, contact: null });
        }}
      />

      <AlertDialog
        open={contactToDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setContactToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('contacts.deleteHeading')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey="contacts.deleteBody"
                values={{ name: contactToDelete?.name ?? '' }}
                components={{ strong: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (contactToDelete) {
                  removeContact.mutate({ id: customer.id, contactId: contactToDelete.id });
                }
                setContactToDelete(null);
              }}
            >
              {t('contacts.deleteConfirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
