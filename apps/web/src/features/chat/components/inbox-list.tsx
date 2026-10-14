import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { Avatar, AvatarFallback } from '@saas-skeleton/ui/components/ui/avatar';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@saas-skeleton/ui/components/ui/toggle-group';
import { cn } from '@saas-skeleton/ui/lib/utils';
import type { ChannelInboxListFilter } from '../../../api/generated/model/channelInboxListFilter';
import { compactTime, initialsOf } from './chat-labels';
import { SimulateInboundPopover } from './simulate-inbound';
import { StartCustomerConversationDialog } from './start-customer-conversation-dialog';
import { flattenInbox, inboxTitle, useInboxList, type InboxEntry } from './use-inbox';

const FILTERS: ChannelInboxListFilter[] = ['all', 'unassigned', 'mine'];

/**
 * Скринька клієнтських розмов (CHAT-2a): спільний список усього тенанта, а не «мої розмови».
 * Фільтр «mine» порожній, доки не зʼявиться призначення (CHAT-2b), але лишається в контролі:
 * форма інтерфейсу не змінюється, коли дія з'являється. Особистих лічильників непрочитаного тут
 * немає — лише «чекає відповіді» (остання репліка клієнтська).
 */
export function InboxList() {
  const { t } = useTranslation('chat');
  const [filter, setFilter] = useState<ChannelInboxListFilter>('all');
  const query = useInboxList(filter);
  const entries = useMemo(() => flattenInbox(query.data?.pages), [query.data?.pages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <StartCustomerConversationDialog />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border p-2">
        <ToggleGroup
          value={[filter]}
          onValueChange={(next: string[]) => {
            const picked = next[0] as ChannelInboxListFilter | undefined;
            if (picked) setFilter(picked);
          }}
          variant="outline"
          size="sm"
          aria-label={t('inbox.filter.label')}
        >
          {FILTERS.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(`inbox.filter.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {import.meta.env.DEV && <SimulateInboundPopover />}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {query.isLoading && <InboxSkeleton />}

        {query.isError && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle className="text-destructive">{t('inbox.loadError')}</EmptyTitle>
              <EmptyDescription>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  <RotateCw />
                  {t('actions.retry')}
                </Button>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {!query.isLoading && !query.isError && entries.length === 0 && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>{t(`inbox.empty.${filter}.title`)}</EmptyTitle>
              <EmptyDescription>{t(`inbox.empty.${filter}.description`)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id}>
              <InboxRow entry={entry} />
            </li>
          ))}
        </ul>

        {query.hasNextPage && (
          <div className="flex justify-center py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              {query.isFetchingNextPage ? <Spinner /> : null}
              {t('list.loadMore')}
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function InboxRow({ entry }: { entry: InboxEntry }) {
  const { t } = useTranslation('chat');
  const { conversationId } = useParams({ strict: false });
  const isActive = conversationId === entry.id;
  const title = inboxTitle(entry) ?? t('inbox.unknownContact');
  const channelNumber = entry.channel.displayPhoneNumber;

  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: entry.id }}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <Item
        size="sm"
        className={cn('rounded-none', isActive ? 'bg-accent' : 'hover:bg-accent/60')}
        data-active={isActive}
      >
        <ItemMedia>
          <Avatar className="size-9">
            <AvatarFallback>{initialsOf(title)}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <ItemTitle className={cn('truncate', entry.awaitingReply && 'font-semibold')}>
              {title}
            </ItemTitle>
            <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {compactTime(entry.lastMessageAt)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <ItemDescription className="truncate">
              {entry.lastMessagePreview ?? t('list.noMessages')}
            </ItemDescription>
            {entry.awaitingReply && (
              <span
                className="ml-auto size-2 shrink-0 rounded-full bg-primary"
                role="img"
                aria-label={t('inbox.awaitingReply')}
              />
            )}
          </div>
          {/* Провайдер, номер каналу і привʼязаний клієнт — окремим рядком: у скриньці кількох
              номерів і провайдерів без цього не видно, куди написали, а без клієнта — що людина
              ще не привʼязана */}
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[0.625rem]">
              {t(`inbox.provider.${entry.channel.provider}`, { defaultValue: entry.channel.provider })}
            </Badge>
            <span className="truncate">
              {[entry.contact.customer?.name ?? t('inbox.notLinked'), channelNumber]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
        </ItemContent>
      </Item>
    </Link>
  );
}

function InboxSkeleton() {
  return (
    <ul className="flex flex-col gap-2 p-3">
      {[0, 1, 2, 3].map((index) => (
        <li key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
