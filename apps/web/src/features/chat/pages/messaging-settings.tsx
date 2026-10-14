import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, RefreshCw, Webhook } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@saas-skeleton/ui/components/ui/collapsible';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { Alert, AlertDescription } from '@saas-skeleton/ui/components/ui/alert';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { formatDateTime, formatRelativeTime } from '@saas-skeleton/ui/lib/format';
import {
  getMessagingSettingsListQueryKey,
  useMessagingSettingsDisconnect,
  useMessagingSettingsList,
  useMessagingSettingsLogs,
  useMessagingSettingsSync,
  useMessagingSettingsUpdateChannel,
} from '../../../api/generated/api';
import { ConnectWhatsAppDialog } from '../components/connect-whatsapp-dialog';
import { CapturedEvents, NumberWebhook } from '../components/webhook-panels';
import { channelState, formatCountdown, tokenState } from '../components/whatsapp-helpers';
import type { MessagingAccountListResponseDtoOutputItemsItem } from '../../../api/generated/model/messagingAccountListResponseDtoOutputItemsItem';

// Сторінка показує живий стан вебхука: лічильники й «останній вебхук» оновлюються самі
const REFETCH_INTERVAL_MS = 10_000;

/**
 * Налаштування каналів тенанта (CHAT-2a, лише ADMIN): акаунт провайдера, його канали і блок
 * «Вебхук» — куди провайдер має слати доставки й чи щось уже приходило. Підписка на боці
 * провайдера (і її стан) — CHAT-3a: тут лише те, що видно без звернення до нього.
 */
export function MessagingSettingsPage() {
  const { t } = useTranslation('chat');
  const { data, isLoading } = useMessagingSettingsList({
    query: { refetchInterval: REFETCH_INTERVAL_MS },
  });
  const accounts = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        label="MessagingSettingsPage"
        breadcrumbs={[{ label: t('settings.title') }]}
        subtitle={t('settings.subtitle')}
        actions={
          !isLoading && !accounts.some((account) => account.provider === 'meta_cloud') ? (
            <ConnectWhatsAppDialog
              trigger={<Button size="sm">{t('settings.connect.open')}</Button>}
            />
          ) : undefined
        }
      />

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && accounts.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Webhook />
            </EmptyMedia>
            <EmptyTitle>{t('settings.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('settings.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </div>
  );
}

function AccountCard({ account }: { account: MessagingAccountListResponseDtoOutputItemsItem }) {
  const { t } = useTranslation('chat');
  const { webhook } = account;
  const last = webhook.lastDeliveryAt;
  const counts = webhook.last24h;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {account.name}
          <Badge variant="secondary">{account.provider}</Badge>
          <Badge variant={account.status === 'CONNECTED' ? 'success' : 'warning'}>
            {t(`settings.status.${account.status}`)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {account.provider === 'meta_cloud' && <WhatsAppSection account={account} />}

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t('settings.webhook.title')}</h3>
          {account.provider === 'meta_cloud' ? (
            <Alert>
              <AlertDescription>{t('settings.webhook.notConnected')}</AlertDescription>
            </Alert>
          ) : (
            <>
              {webhook.address ? (
                <CopyField label={t('settings.webhook.address')} value={webhook.address} />
              ) : (
                <Alert>
                  <AlertDescription>{t('settings.webhook.addressMissing')}</AlertDescription>
                </Alert>
              )}
              {webhook.verifyToken && (
                <CopyField label={t('settings.webhook.verifyToken')} value={webhook.verifyToken} />
              )}

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('settings.webhook.signingSecret')}
                  </dt>
                  <dd>
                    {webhook.signingSecretSet
                      ? t('settings.webhook.secretSet')
                      : t('settings.webhook.secretNotSet')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('settings.webhook.lastDelivery')}
                  </dt>
                  <dd title={last ? formatDateTime(last) : undefined}>
                    {last
                      ? (formatRelativeTime(last) ?? formatDateTime(last))
                      : t('settings.webhook.neverDelivered')}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('settings.webhook.last24h')}</dt>
                  <dd className="flex flex-wrap gap-x-4 gap-y-1">
                    {(['received', 'processed', 'failed', 'unroutable'] as const).map((key) => (
                      <span
                        key={key}
                        className={
                          key === 'failed' && counts[key] > 0 ? 'text-destructive' : undefined
                        }
                      >
                        {counts[key]} {t(`settings.webhook.counts.${key}`)}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>

        {account.provider !== 'meta_cloud' && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t('settings.channels.title')}</h3>
            {account.channels.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.channels.none')}</p>
            )}
            <ul className="flex flex-col gap-1">
              {account.channels.map((channel) => (
                <li key={channel.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{channel.displayPhoneNumber ?? channel.id}</span>
                  <Badge variant={channel.isEnabled ? 'success' : 'secondary'}>
                    {channel.isEnabled
                      ? t('settings.channels.enabled')
                      : t('settings.channels.disabled')}
                  </Badge>
                  {channel.isDefault && (
                    <Badge variant="outline">{t('settings.channels.default')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Секція WhatsApp акаунта (CHAT-3a): токен (вид, строк, права), номери з вмикачами й default, «Refresh»,
 * «Update token», «Disconnect» і недавній журнал викликів. Усе, що тут показано, — те, що провайдер
 * підтвердив; чого перевірити не було чим (без app secret) — так і підписано.
 */
function WhatsAppSection({ account }: { account: MessagingAccountListResponseDtoOutputItemsItem }) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: getMessagingSettingsListQueryKey() });
  };
  const failed = (): void => {
    toast.add({ type: 'error', title: t('settings.whatsapp.actionFailed') });
  };

  const sync = useMessagingSettingsSync({
    mutation: {
      onSuccess: async (result) => {
        await refresh();
        toast.add({
          type: 'success',
          title: t('settings.whatsapp.synced', {
            created: result.created,
            updated: result.updated,
            missing: result.missing,
          }),
        });
      },
      onError: failed,
    },
  });
  const disconnect = useMessagingSettingsDisconnect({
    mutation: { onSuccess: refresh, onError: failed },
  });
  const update = useMessagingSettingsUpdateChannel({
    mutation: { onSuccess: refresh, onError: failed },
  });

  const token = account.token;
  const state = token ? tokenState(token, Date.now()) : null;
  const receipts = account.channels.every((channel) => channel.deliveryReceipts);

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('settings.whatsapp.token.title')}</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sync.isPending || account.status === 'DISABLED'}
              onClick={() => {
                sync.mutate({ id: account.id });
              }}
            >
              <RefreshCw />
              {t('settings.whatsapp.refresh')}
            </Button>
            <ConnectWhatsAppDialog
              accountId={account.id}
              trigger={
                <Button variant="outline" size="sm">
                  {t('settings.whatsapp.updateToken')}
                </Button>
              }
            />
            {account.status !== 'DISABLED' && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" size="sm">
                      {t('settings.whatsapp.disconnect')}
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('settings.whatsapp.disconnectTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('settings.whatsapp.disconnectBody')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        disconnect.mutate({ id: account.id });
                      }}
                    >
                      {t('settings.whatsapp.disconnect')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {account.lastError && (
          <Alert variant="destructive">
            <AlertDescription>{account.lastError}</AlertDescription>
          </Alert>
        )}

        {token && state ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('settings.whatsapp.token.value')}
              </dt>
              <dd className="font-mono">{token.mask}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('settings.whatsapp.token.kind')}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {state.state === 'unverified' ? (
                  <Badge variant="warning">{t('settings.whatsapp.token.unverified')}</Badge>
                ) : state.state === 'temporary' ? (
                  <Badge variant="warning">
                    {t('settings.whatsapp.token.temporary', {
                      left: formatCountdown(state.msLeft),
                    })}
                  </Badge>
                ) : state.state === 'expired' ? (
                  <Badge variant="destructive">{t('settings.whatsapp.token.expired')}</Badge>
                ) : (
                  <Badge variant="success">
                    {t(`settings.whatsapp.token.kinds.${state.kind}`)}
                  </Badge>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t('settings.whatsapp.token.scopes')}
              </dt>
              <dd className="flex flex-wrap gap-1">
                {token.verified ? (
                  token.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">
                    {t('settings.whatsapp.token.scopesUnverified')}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t('settings.whatsapp.token.none')}</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('settings.channels.title')}</h3>
        {account.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            {t('settings.whatsapp.lastSync', {
              when: formatRelativeTime(account.lastSyncAt) ?? formatDateTime(account.lastSyncAt),
            })}
          </p>
        )}
        {account.channels.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('settings.channels.none')}</p>
        )}
        <ul className="flex flex-col divide-y rounded-md border">
          {account.channels.map((channel) => {
            const state = channelState(channel);
            return (
              <li key={channel.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{channel.displayPhoneNumber ?? channel.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      channel.verifiedName,
                      channel.qualityRating &&
                        t('settings.whatsapp.quality', { value: channel.qualityRating }),
                      channel.mode,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {state === 'missing' && (
                  <Badge variant="destructive">{t('settings.whatsapp.missing')}</Badge>
                )}
                {state === 'default' && (
                  <Badge variant="outline">{t('settings.channels.default')}</Badge>
                )}
                <label className="flex items-center gap-2 text-xs">
                  {t('settings.channels.enabled')}
                  <Switch
                    checked={channel.isEnabled}
                    disabled={channel.isMissing || update.isPending}
                    onCheckedChange={(checked) => {
                      update.mutate({ id: channel.id, data: { isEnabled: checked } });
                    }}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={
                    !channel.isEnabled || channel.isDefault || channel.isMissing || update.isPending
                  }
                  onClick={() => {
                    update.mutate({ id: channel.id, data: { isDefault: true } });
                  }}
                >
                  {t('settings.whatsapp.makeDefault')}
                </Button>
                <div className="basis-full">
                  <NumberWebhook channelId={channel.id} />
                </div>
              </li>
            );
          })}
        </ul>
        {!receipts && (
          <Alert>
            <AlertDescription>{t('settings.whatsapp.receiptsNotice')}</AlertDescription>
          </Alert>
        )}
      </section>

      <CallLog accountId={account.id} />
      <CapturedEvents accountId={account.id} />
    </>
  );
}

/** Недавні виклики до провайдера: що сталося, без секретів і без вмісту — вантажиться, коли розгорнули */
function CallLog({ accountId }: { accountId: string }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const query = useMessagingSettingsLogs(accountId, { limit: 20 }, { query: { enabled: open } });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm">
            {t(open ? 'settings.whatsapp.log.hide' : 'settings.whatsapp.log.show')}
          </Button>
        }
      />
      <CollapsibleContent>
        {query.isLoading && <Skeleton className="h-16 w-full" />}
        {query.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('settings.whatsapp.log.empty')}</p>
        )}
        <ul className="flex flex-col gap-1 text-xs">
          {query.data?.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
              <Badge variant={entry.ok ? 'success' : 'destructive'}>{entry.operation}</Badge>
              <span>{entry.httpStatus ?? '—'}</span>
              <span className="text-muted-foreground">{entry.durationMs} ms</span>
              {entry.errorCode && (
                <span className="text-destructive">
                  {entry.errorCode}
                  {entry.errorTitle ? ` · ${entry.errorTitle}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Значення з кнопкою «копіювати»: адресу й токен переносять у кабінет провайдера руками */
function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t('settings.webhook.copied') : t('settings.webhook.copy')}
        </Button>
      </div>
    </div>
  );
}
