import { useTranslation } from 'react-i18next';
import { Webhook } from 'lucide-react';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { useChannelEventsUnroutable } from '../../../api/generated/api';

// Сторінка моніторингу, як /operations/jobs: оновлюється сама
const REFETCH_INTERVAL_MS = 10_000;

/**
 * Вебхуки каналів, що не вдалося привʼязати до тенанта: невідомий ключ, вимкнений акаунт.
 * Тіло повідомлення тут не зберігається, ключ — лише хешем: оператор бачить, ЩО і коли
 * не спрацювало, а не вміст листування.
 */
export function ChannelEventsPage() {
  const { t } = useTranslation(['chat']);
  const { data } = useChannelEventsUnroutable(
    { limit: 100 },
    { query: { refetchInterval: REFETCH_INTERVAL_MS } },
  );
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        label="ChannelEventsPage"
        breadcrumbs={[{ label: t('channelEvents.title') }]}
        subtitle={t('channelEvents.subtitle')}
      />

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Webhook />
            </EmptyMedia>
            <EmptyTitle>{t('channelEvents.empty')}</EmptyTitle>
            <EmptyDescription>{t('channelEvents.emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('channelEvents.columns.time')}</TableHead>
              <TableHead>{t('channelEvents.columns.provider')}</TableHead>
              <TableHead>{t('channelEvents.columns.reason')}</TableHead>
              <TableHead>{t('channelEvents.columns.keyHash')}</TableHead>
              <TableHead>{t('channelEvents.columns.ip')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <DateTimeCell value={event.receivedAt} />
                </TableCell>
                <TableCell>{event.provider}</TableCell>
                <TableCell>
                  <Badge variant="warning">
                    {t(`channelEvents.reasons.${event.reason}`, { defaultValue: event.reason })}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{event.keyHash.slice(0, 12)}</TableCell>
                <TableCell>{event.ip ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
