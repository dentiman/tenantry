import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { RotateCw, SquarePenIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useAiConversation, useAiReset } from '../../api/generated/api';
import { invalidateAiConversations, useAiHistory, type AiConversationSummary } from './ai-queries';
import { useAiEnabled } from './components/use-ai-enabled';

type HistoryGroup = 'today' | 'yesterday' | 'week' | 'older';
const GROUP_ORDER: readonly HistoryGroup[] = ['today', 'yesterday', 'week', 'older'];

/**
 * Друга колонка area «Assistant» — історія розмов з асистентом.
 *
 * Як і в чаті, це компонент (`Area.panel`), а не пункти меню: список динамічний,
 * курсорний і перечитується за socket-сигналом (`ai-sync.ts`), тож у реєстр
 * навігації, зібраний на збірці, він не влазить за визначенням.
 *
 * Групи за датою останнього повідомлення (сьогодні / вчора / тиждень / раніше) —
 * звична форма історії AI-чатів; групування клієнтське, по вже завантажених сторінках.
 */
export function AssistantSidebar() {
  const { t } = useTranslation('ai');
  const isEnabled = useAiEnabled();
  const query = useAiHistory(isEnabled);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reset = useAiReset();
  // Поточна розмова: на індексі `/assistant` підсвічується саме вона
  const { data: current } = useAiConversation({ query: { enabled: isEnabled } });
  const { conversationId } = useParams({ strict: false });
  const selectedId = conversationId ?? current?.id;

  const groups = useMemo(() => {
    const items = query.data?.pages.flatMap((page) => page.items) ?? [];
    const byGroup = new Map<HistoryGroup, AiConversationSummary[]>();
    for (const item of items) {
      const group = groupOf(item.lastMessageAt);
      byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
    }
    return GROUP_ORDER.flatMap((group) => {
      const groupItems = byGroup.get(group);
      return groupItems ? [{ group, items: groupItems }] : [];
    });
  }, [query.data?.pages]);

  const startNew = (): void => {
    // Порожня поточна вже є «новою» — другий reset дав би ще один порожній рядок
    if (current?.messages.length === 0) {
      void navigate({ to: '/assistant' });
      return;
    }
    reset.mutate(undefined, {
      onSettled: () => {
        void invalidateAiConversations(queryClient);
      },
      onSuccess: () => {
        void navigate({ to: '/assistant' });
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-sidebar-border p-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          disabled={!isEnabled || reset.isPending}
          onClick={startNew}
        >
          <SquarePenIcon />
          {t('newConversation')}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {query.isLoading && <HistorySkeleton />}

        {query.isError && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle className="text-destructive">{t('history.loadError')}</EmptyTitle>
              <EmptyDescription>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  <RotateCw />
                  {t('history.retry')}
                </Button>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {isEnabled && !query.isLoading && !query.isError && groups.length === 0 && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>{t('history.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('history.empty.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {groups.map(({ group, items }) => (
          <section key={group} className="pb-2">
            <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
              {t(`history.groups.${group}`)}
            </h3>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id}>
                  <HistoryRow item={item} isSelected={item.id === selectedId} />
                </li>
              ))}
            </ul>
          </section>
        ))}

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
              {t('history.loadMore')}
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function HistoryRow({ item, isSelected }: { item: AiConversationSummary; isSelected: boolean }) {
  const { t } = useTranslation('ai');

  return (
    <Link
      to="/assistant/$conversationId"
      params={{ conversationId: item.id }}
      data-active={isSelected}
      title={item.title}
      /* Смуга на всю ширину колонки, як рядок списку розмов чату; `ring-inset` —
         бо звичайне кільце обрізалось би стінками колонки */
      className={cn(
        'flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{item.title || t('history.untitled')}</span>
      {item.status === 'ACTIVE' && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('history.current')}</span>
      )}
    </Link>
  );
}

function groupOf(iso: string): HistoryGroup {
  const date = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  if (date >= startOfToday) return 'today';
  if (date.getTime() >= startOfToday.getTime() - dayMs) return 'yesterday';
  if (date.getTime() >= startOfToday.getTime() - 7 * dayMs) return 'week';
  return 'older';
}

function HistorySkeleton() {
  return (
    <ul className="flex flex-col gap-2 p-3">
      {[0, 1, 2, 3, 4].map((index) => (
        <li key={index}>
          <Skeleton className="h-4 w-full" />
        </li>
      ))}
    </ul>
  );
}
