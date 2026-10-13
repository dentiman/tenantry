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

/** Підпис рядка: імʼя з профілю провайдера; без нього — привʼязаний клієнт; інакше `null` (рендерер підставить текст) */
export function inboxTitle(entry: Pick<InboxEntry, 'contact'>): string | null {
  return entry.contact.displayName ?? entry.contact.customer?.name ?? null;
}
