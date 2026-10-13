import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Webhook } from 'lucide-react';
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
import { useMessagingSettingsList } from '../../../api/generated/api';
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
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t('settings.webhook.title')}</h3>

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
                    className={key === 'failed' && counts[key] > 0 ? 'text-destructive' : undefined}
                  >
                    {counts[key]} {t(`settings.webhook.counts.${key}`)}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </section>

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
      </CardContent>
    </Card>
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
