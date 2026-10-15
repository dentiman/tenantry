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
 * Титул рядка скриньки — той, з ким переписка: людина по той бік каналу (імʼя з профілю провайдера), а
 * без імені — привʼязаний кастомер; без обох — `null` (рендерер підставить текст). Кастомер-організація
 * сама нічого не пише, тому його назва — другий рядок (`inboxCompany`), а не титул.
 */
export function inboxTitle(entry: Pick<InboxEntry, 'contact'>): string | null {
  return entry.contact.displayName ?? entry.contact.customer?.name ?? null;
}

/**
 * Кастомер як «чия це людина»: назва, якщо вона не збігається з титулом (кастомер-особа — це і є співрозмовник,
 * дублювати нічого)
 */
export function inboxCompany(entry: Pick<InboxEntry, 'contact'>): string | null {
  const customer = entry.contact.customer;
  if (!customer || customer.name === inboxTitle(entry)) return null;
  return customer.name;
}
