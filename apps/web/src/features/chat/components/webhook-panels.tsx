import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
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
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@saas-skeleton/ui/components/ui/collapsible';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import {
  getMessagingSettingsWebhookStatusQueryKey,
  useMessagingSettingsSubscribeWebhook,
  useMessagingSettingsUnsubscribeWebhook,
  useMessagingSettingsWebhookEventList,
  useMessagingSettingsWebhookStatus,
} from '../../../api/generated/api';
import { summarizeWebhookBody, webhookAction } from './whatsapp-helpers';

/**
 * Куди йдуть вебхуки НОМЕРА і явна підписка (CHAT-3b1). Стан читається з Meta на льоту, а не береться з бази:
 * саме Meta вирішує, куди йдуть події. Нічого не підписується саме — лише ці кнопки.
 */
export function NumberWebhook({ channelId }: { channelId: string }) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const query = useMessagingSettingsWebhookStatus(channelId, {
    query: { retry: false, meta: { silentError: true } },
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: getMessagingSettingsWebhookStatusQueryKey(channelId),
    });
  };
  const failed = (error: unknown): void => {
    toast.add({
      type: 'error',
      title: t('settings.webhookNumber.failed'),
      description: parseApiError(error).message,
    });
  };
  const subscribe = useMessagingSettingsSubscribeWebhook({
    mutation: { onSuccess: refresh, onError: failed },
  });
  const unsubscribe = useMessagingSettingsUnsubscribeWebhook({
    mutation: { onSuccess: refresh, onError: failed },
  });
  const busy = subscribe.isPending || unsubscribe.isPending;

  if (query.isLoading) return <Skeleton className="h-5 w-48" />;
  if (query.isError || !query.data) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('settings.webhookNumber.unreadable')}{' '}
        <Button variant="link" size="xs" onClick={() => void query.refetch()}>
          {t('actions.retry')}
        </Button>
      </p>
    );
  }

  const status = query.data;
  const action = webhookAction(status);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{t('settings.webhookNumber.label')}</span>
      {status.state === 'ours' && (
        <Badge variant="success">{t('settings.webhookNumber.ours')}</Badge>
      )}
      {status.state === 'none' && (
        <Badge variant="secondary">{t('settings.webhookNumber.none')}</Badge>
      )}
      {status.state === 'elsewhere' && (
        <Badge variant="warning">
          {t('settings.webhookNumber.elsewhere', { host: status.host ?? '?' })}
        </Badge>
      )}
      {status.subscribedAt && (
        <span className="text-muted-foreground">{formatDateTime(status.subscribedAt)}</span>
      )}

      {action.kind === 'unsubscribe' && (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => {
            unsubscribe.mutate({ id: channelId });
          }}
        >
          {t('settings.webhookNumber.unsubscribe')}
        </Button>
      )}
      {action.kind === 'subscribe' && (
        <Button
          size="xs"
          disabled={busy}
          onClick={() => {
            subscribe.mutate({ id: channelId, data: {} });
          }}
        >
          {t('settings.webhookNumber.subscribe')}
        </Button>
      )}
      {action.kind === 'no-address' && (
        <span className="text-muted-foreground">{t('settings.webhookNumber.noAddress')}</span>
      )}
      {action.kind === 'takeover' && (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="xs" variant="outline" disabled={busy}>
                {t('settings.webhookNumber.takeOver')}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('settings.webhookNumber.takeOverTitle', { host: action.host })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('settings.webhookNumber.takeOverBody', { host: action.host })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  subscribe.mutate({ id: channelId, data: { replaceHost: action.host } });
                }}
              >
                {t('settings.webhookNumber.takeOver')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/** Захоплені вебхуки акаунта як збережено (CHAT-3b1): вантажиться, коли розгорнули; тіло — за запитом */
export function CapturedEvents({ accountId }: { accountId: string }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useMessagingSettingsWebhookEventList(
    accountId,
    { limit: 20 },
    { query: { enabled: open } },
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm">
            {t(open ? 'settings.webhookEvents.hide' : 'settings.webhookEvents.show')}
          </Button>
        }
      />
      <CollapsibleContent>
        {query.isLoading && <Skeleton className="h-16 w-full" />}
        {query.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('settings.webhookEvents.empty')}</p>
        )}
        <ul className="flex flex-col gap-2 text-xs">
          {query.data?.items.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{formatDateTime(event.receivedAt)}</span>
                <Badge variant={event.state === 'FAILED' ? 'destructive' : 'secondary'}>
                  {event.state}
                </Badge>
                <Badge
                  variant={
                    event.signatureValid === true
                      ? 'success'
                      : event.signatureValid === false
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {t(
                    `settings.webhookEvents.signature.${event.signatureValid === null ? 'unchecked' : event.signatureValid ? 'valid' : 'invalid'}`,
                  )}
                </Badge>
                <span>{summarizeWebhookBody(event.body)}</span>
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => {
                    setExpanded(expanded === event.id ? null : event.id);
                  }}
                >
                  {t(
                    expanded === event.id
                      ? 'settings.webhookEvents.hideBody'
                      : 'settings.webhookEvents.showBody',
                  )}
                </Button>
              </div>
              {expanded === event.id && (
                <ScrollArea className="max-h-64 rounded bg-muted">
                  <pre className="whitespace-pre-wrap break-all p-2">{prettyBody(event.body)}</pre>
                </ScrollArea>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
