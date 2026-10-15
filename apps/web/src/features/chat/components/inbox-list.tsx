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
import { CustomerAvatar } from '../../customers/components/customer-identity';
import { SimulateInboundPopover } from './simulate-inbound';
import { StartCustomerConversationDialog } from './start-customer-conversation-dialog';
import { flattenInbox, inboxContactName, inboxTitle, useInboxList, type InboxEntry } from './use-inbox';

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

/**
 * Рядок скриньки. Верх — ідентичність у розкладці `UserIdentity`/`CustomerIdentity` (аватар 32px,
 * титул `leading-tight`, другий рядок `text-xs`), але другий рядок тут не дані кастомера, а прев'ю
 * останнього повідомлення, тож блок складено з тих самих примітивів, а не викликом готового
 * компонента. Низ — мітка каналу — на всю ширину рядка під аватаром, а не в колонці тексту.
 * Привʼязаний контакт показується аватаром кастомера (`CustomerAvatar`: організація — квадрат
 * із будівлею, особа — коло); без привʼязки — коло з ініціалами людини.
 */
function InboxRow({ entry }: { entry: InboxEntry }) {
  const { t } = useTranslation('chat');
  const { conversationId } = useParams({ strict: false });
  const isActive = conversationId === entry.id;
  const title = inboxTitle(entry) ?? t('inbox.unknownContact');
  const customer = entry.contact.customer;
  const channelNumber = entry.channel.displayPhoneNumber;
  // Клієнт уже в титулі — третій рядок називає людину, що пише; без клієнта — що привʼязки ще нема
  const who = customer ? inboxContactName(entry) : t('inbox.notLinked');

  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: entry.id }}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div
        className={cn(
          'flex flex-col gap-1.5 px-3 py-2.5 transition-colors',
          isActive ? 'bg-accent' : 'hover:bg-accent/60',
        )}
        data-active={isActive}
      >
        <Item size="sm" className="w-full min-w-0 flex-nowrap gap-3 p-0">
          <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
            {customer ? (
              <CustomerAvatar id={customer.id} kind={customer.kind} name={customer.name} />
            ) : (
              <Avatar>
                <AvatarFallback colorSeed={entry.contact.id}>{initialsOf(title)}</AvatarFallback>
              </Avatar>
            )}
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <ItemTitle
                className={cn(
                  'min-w-0 max-w-full truncate leading-tight',
                  entry.awaitingReply && 'font-semibold',
                )}
                title={title}
              >
                {title}
              </ItemTitle>
              <span className="ml-auto shrink-0 text-xs leading-tight whitespace-nowrap text-muted-foreground">
                {compactTime(entry.lastMessageAt)}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <ItemDescription className="line-clamp-none truncate text-xs leading-tight">
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
          </ItemContent>
        </Item>
        {/* Провайдер, хто пише і номер каналу — на всю ширину: у скриньці кількох номерів і провайдерів без
            цього не видно, куди написали, а без клієнта — що людина ще не привʼязана */}
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[0.625rem]">
            {t(`inbox.provider.${entry.channel.provider}`, { defaultValue: entry.channel.provider })}
          </Badge>
          <span className="truncate">{[who, channelNumber].filter(Boolean).join(' · ')}</span>
        </p>
      </div>
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
