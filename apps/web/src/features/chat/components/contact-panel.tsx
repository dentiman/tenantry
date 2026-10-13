import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { Link2, Link2Off, UserPlus } from 'lucide-react';
import {
  ContextPanelHeader,
  useContextPanel,
} from '@saas-skeleton/ui/components/context-panel-slot';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { useDebouncedValue } from '@saas-skeleton/ui/hooks/use-debounced-value';
import {
  getChannelContactQueryKey,
  useChannelContact,
  useChannelCreateCustomer,
  useChannelLinkCustomer,
  useChannelUnlinkCustomer,
  useCustomersFindAll,
} from '../../../api/generated/api';
import { INBOX_KEY_PREFIX } from '../chat-keys';

/**
 * Картка контакта клієнтської розмови — у третій колонці шела (CHAT-2a). Показує, хто це по той
 * бік каналу, і дозволяє привʼязати його до клієнта: до наявного, до нового (з імені й телефону
 * розмови) або зняти привʼязку. Автоматичної привʼязки за номером тут не видно — вона вже
 * відбулась на сервері, коли номер належав рівно одному клієнтові.
 */
export function ContactPanel({ contactId }: { contactId: string }) {
  const { t } = useTranslation('chat');
  const { setOpen } = useContextPanel();
  const queryClient = useQueryClient();
  const query = useChannelContact(contactId);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Привʼязка змінює і картку, і рядки скриньки (там видно імʼя клієнта)
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChannelContactQueryKey(contactId) }),
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith(INBOX_KEY_PREFIX),
      }),
    ]);
  };
  const onError = (error: unknown): void => {
    const conflict = isAxiosError(error) && error.response?.status === 409;
    toast.add({
      type: 'error',
      title: conflict ? t('contact.errors.alreadyLinked') : t('contact.errors.failed'),
    });
    void refresh();
  };

  const link = useChannelLinkCustomer({ mutation: { onSuccess: refresh, onError } });
  const create = useChannelCreateCustomer({ mutation: { onSuccess: refresh, onError } });
  const unlink = useChannelUnlinkCustomer({ mutation: { onSuccess: refresh, onError } });
  const busy = link.isPending || create.isPending || unlink.isPending;

  const contact = query.data;
  const customer = contact?.customer ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextPanelHeader
        title={contact?.displayName ?? t('inbox.unknownContact')}
        description={t('contact.title')}
        onClose={() => {
          setOpen(false);
        }}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {query.isLoading && <Skeleton className="h-24 w-full" />}

          {contact && (
            <>
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('contact.addresses')}
                </h3>
                {contact.addresses.map((address) => (
                  <p key={`${address.kind}:${address.value}`} className="text-sm">
                    {address.value}
                  </p>
                ))}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('contact.customer')}
                </h3>
                {customer ? (
                  <>
                    <p className="text-sm font-medium">{customer.name}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link
                            to="/workspace/customers/$customerId"
                            params={{ customerId: customer.id }}
                          />
                        }
                      >
                        {t('contact.openCustomer')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          unlink.mutate({ id: contactId });
                        }}
                      >
                        <Link2Off />
                        {t('contact.unlink')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{t('contact.notLinked')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setPickerOpen(true);
                        }}
                      >
                        <Link2 />
                        {t('contact.link')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          create.mutate({ id: contactId });
                        }}
                      >
                        <UserPlus />
                        {t('contact.create')}
                      </Button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </ScrollArea>

      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(customerId) => {
          setPickerOpen(false);
          link.mutate({ id: contactId, data: { customerId } });
        }}
      />
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

/** Вибір наявного клієнта: серверний пошук і короткий список — довгий вибір уточнюється пошуком */
function CustomerPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (customerId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const { data, isFetching } = useCustomersFindAll(
    { search: search || undefined, limit: 20, sortBy: 'name', sortOrder: 'asc' },
    { query: { enabled: open } },
  );
  const customers = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contact.picker.title')}</DialogTitle>
          <DialogDescription>{t('contact.picker.hint')}</DialogDescription>
        </DialogHeader>
        <Input
          value={text}
          placeholder={t('contact.picker.search')}
          aria-label={t('contact.picker.search')}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <ScrollArea className="max-h-72">
          {!isFetching && customers.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t('contact.picker.empty')}</p>
          )}
          <ul className="flex flex-col">
            {customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    onPick(customer.id);
                  }}
                >
                  <span className="text-sm font-medium">{customer.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[customer.numberLabel, customer.phone ?? customer.email]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
