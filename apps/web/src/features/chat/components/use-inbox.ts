import { useInfiniteQuery } from '@tanstack/react-query';
import { channelInboxList } from '../../../api/generated/api';
import type { ChannelInboxListFilter } from '../../../api/generated/model/channelInboxListFilter';
import type { InboxListResponseDtoOutputItemsItem } from '../../../api/generated/model/inboxListResponseDtoOutputItemsItem';
import { INBOX_PAGE, inboxKey } from '../chat-keys';

export type InboxEntry = InboxListResponseDtoOutputItemsItem;

/** Скринька клієнтських розмов: курсорний фід, свіжі згори; фільтр — частина ключа кеша */
export function useInboxList(filter: ChannelInboxListFilter) {
  return useInfiniteQuery({
    queryKey: inboxKey(filter),
    queryFn: ({ pageParam, signal }) =>
      channelInboxList(
        { limit: INBOX_PAGE, filter, ...(pageParam ? { cursor: pageParam } : {}) },
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenInbox(pages: { items: InboxEntry[] }[] | undefined): InboxEntry[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/**
 * Титул рядка скриньки: привʼязаний клієнт (його аватар і назва — те, що менеджер знає з CRM), інакше
 * імʼя з профілю провайдера; без обох — `null` (рендерер підставить текст)
 */
export function inboxTitle(entry: Pick<InboxEntry, 'contact'>): string | null {
  return entry.contact.customer?.name ?? entry.contact.displayName ?? null;
}

/**
 * Хто саме з клієнта пише — для третього рядка, коли титул уже клієнт: імʼя з профілю, якщо воно
 * відрізняється від титулу (особа-кастомер пише від свого імені, тож дублювати нічого)
 */
export function inboxContactName(entry: Pick<InboxEntry, 'contact'>): string | null {
  const { displayName, customer } = entry.contact;
  if (!customer || !displayName || displayName === customer.name) return null;
  return displayName;
}
