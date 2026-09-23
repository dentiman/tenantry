import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from '@tanstack/react-router';
import { Hash, RotateCw, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@saas-skeleton/ui/components/ui/avatar';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@saas-skeleton/ui/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@saas-skeleton/ui/components/ui/item';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useAuthStore } from '../../stores/auth.store';
import { compactTime, conversationLabel, initialsOf } from './chat-labels';
import { flattenConversations, useConversationList, type Conversation } from './use-chat';

/**
 * Друга колонка area «Chat»: курсорний фід розмов, а не `DataGrid` (docs/chat.md §6).
 * Нескінченний потік із прев'ю і бейджем непрочитаних — це не таблиця з
 * фільтрами в URL, і спроба зробити її таблицею дає обидва інтерфейси поганими.
 *
 * Пошук у цій фазі — клієнтський фільтр по вже завантажених сторінках. Серверний
 * `q` приходить у `0.3`: поки розмов одиниці, запит на кожну літеру дав би лише
 * мигання списку.
 */
export function ConversationList() {
  const { t } = useTranslation('chat');
  const viewerId = useAuthStore((state) => state.user?.id ?? '');
  const query = useConversationList();
  const [search, setSearch] = useState('');

  const conversations = useMemo(
    () => flattenConversations(query.data?.pages),
    [query.data?.pages],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return conversations;
    }
    return conversations.filter((conversation) =>
      conversationLabel(conversation, viewerId, t).toLowerCase().includes(needle),
    );
  }, [conversations, search, viewerId, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Пошук — смуга з власною лінією знизу, а не плитка в полях колонки: та
          сама роль, що в тулбара над таблицею кастомерів. Поля має ТІЛЬКИ вона,
          фід під нею йде від стінки до стінки */}
      <div className="shrink-0 border-b border-sidebar-border p-2">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            placeholder={t('list.search')}
            aria-label={t('list.search')}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </InputGroup>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {query.isLoading && <ConversationListSkeleton />}

        {query.isError && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle className="text-destructive">{t('list.loadError')}</EmptyTitle>
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

        {!query.isLoading && !query.isError && visible.length === 0 && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>
                {search ? t('list.noMatches') : t('sidebar.empty.title')}
              </EmptyTitle>
              <EmptyDescription>
                {search ? t('list.noMatchesHint') : t('sidebar.empty.description')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {/* Без проміжків між рядками: рядок — не плитка, а смуга на всю ширину
            колонки (форма рядка гріда). Роздільних ліній теж немає — у 224px з
            аватаром кожні ~56px вони б рябіли, ритм тримають самі аватари */}
        <ul className="flex flex-col">
          {visible.map((conversation) => (
            <li key={conversation.id}>
              <ConversationRow conversation={conversation} viewerId={viewerId} />
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

function ConversationRow({
  conversation,
  viewerId,
}: {
  conversation: Conversation;
  viewerId: string;
}) {
  const { t } = useTranslation('chat');
  const { conversationId } = useParams({ strict: false });
  const label = conversationLabel(conversation, viewerId, t);
  const isActive = conversationId === conversation.id;
  const hasUnread = conversation.unreadCount > 0;

  // Аватар співрозмовника має сенс лише в розмові на двох; далі це канал
  const other = conversation.participants.find((p) => p.id !== viewerId);
  const isChannel = conversation.isDefault || conversation.participants.length > 2;

  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: conversation.id }}
      /* `ring-inset`: у смуги без скруглень і без полів звичайне кільце
         обрізалось би стінками колонки */
      className="block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <Item
        size="sm"
        className={cn('rounded-none', isActive ? 'bg-accent' : 'hover:bg-accent/60')}
        data-active={isActive}
      >
        <ItemMedia>
          <Avatar className="size-9">
            {!isChannel && other?.avatarUrl ? (
              <AvatarImage src={other.avatarUrl} alt={label} />
            ) : null}
            <AvatarFallback>
              {isChannel ? <Hash className="size-4" /> : initialsOf(label)}
            </AvatarFallback>
          </Avatar>
        </ItemMedia>
        {/* Мета (час, бейдж) стоїть У РЯДКАХ, а не окремою колонкою праворуч:
            колонка під «12 hours ago» з'їдала б половину ширини, і від прев'ю
            лишалось би три літери */}
        <ItemContent className="min-w-0 gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <ItemTitle className={cn('truncate', hasUnread && 'font-semibold')}>
              {label}
            </ItemTitle>
            <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {compactTime(conversation.lastMessageAt)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <ItemDescription className="truncate">
              {conversation.lastMessagePreview ?? t('list.noMessages')}
            </ItemDescription>
            {hasUnread && (
              <Badge className="ml-auto min-w-5 shrink-0 justify-center px-1.5">
                {conversation.unreadCount}
              </Badge>
            )}
          </div>
        </ItemContent>
      </Item>
    </Link>
  );
}

function ConversationListSkeleton() {
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
