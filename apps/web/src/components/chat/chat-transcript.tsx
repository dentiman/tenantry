import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RotateCw } from 'lucide-react';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@saas-skeleton/ui/components/ui/message-scroller';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from '@saas-skeleton/ui/components/ui/message';
import { Bubble, BubbleContent } from '@saas-skeleton/ui/components/ui/bubble';
import { Marker, MarkerContent } from '@saas-skeleton/ui/components/ui/marker';
import { Avatar, AvatarFallback, AvatarImage } from '@saas-skeleton/ui/components/ui/avatar';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { formatDate, formatTime } from '@saas-skeleton/ui/lib/format';
import { useChatOutboxStore, type OutboxMessage } from '../../stores/chat-outbox.store';
import { initialsOf, systemEntryText } from './chat-labels';
import { flattenTranscript, useMarkRead, useTranscript, type ChatMessage } from './use-chat';
import type { Conversation } from './use-chat';

interface ChatTranscriptProps {
  conversation: Conversation;
  viewerId: string;
  onRetry: (body: string, clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

/** Рядок стрічки: або серверне повідомлення, або ще ненадіслане з черги */
type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; groupedWithPrevious: boolean }
  | { kind: 'outbox'; key: string; entry: OutboxMessage };

/**
 * Стрічка розмови.
 *
 * Якір на низ, догортання старої історії вгору і трекінг видимості дає
 * `message-scroller` з реєстру — саме ті чотири його можливості, під які він і
 * обирався (docs/chat.md §4.14.2). Порядок тримає серверний `seq`, не час.
 */
export function ChatTranscript({
  conversation,
  viewerId,
  onRetry,
  onDiscard,
}: ChatTranscriptProps) {
  const { t } = useTranslation('chat');
  const query = useTranscript(conversation.id);
  const markRead = useMarkRead(conversation.id);
  const pending = useChatOutboxStore((state) => state.pending[conversation.id] ?? EMPTY_OUTBOX);

  const messages = useMemo(
    () => flattenTranscript(query.data?.pages),
    [query.data?.pages],
  );

  // Курсор прочитаного рухаємо, коли видно кінець стрічки. Один раз на новий
  // `seq`: повторний рух на те саме число сервер і так проігнорує, але зайвого
  // запиту краще не робити
  const lastReportedSeq = useRef<number>(conversation.lastReadSeq);
  const newestSeq = messages.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (newestSeq > lastReportedSeq.current) {
      lastReportedSeq.current = newestSeq;
      markRead(newestSeq);
    }
  }, [newestSeq, markRead]);

  const rows = useMemo(
    () => buildRows(messages, pending),
    [messages, pending],
  );

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner aria-label={t('transcript.loading')} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle className="text-destructive">{t('transcript.loadError')}</EmptyTitle>
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
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-4 py-3">
          {/* `justify-end` — коротка розмова притискається до композера, як у
              будь-якому месенджері. Коли вміст переростає вʼюпорт, вільного
              місця немає і правило нічого не змінює */}
          <MessageScrollerContent className="justify-end gap-4">
            {/* Догортання вгору: як тільки маркер початку видно — тягнемо старішу
                сторінку. Курсор порожній — початок розмови, і маркер це каже */}
            <TranscriptStart
              hasMore={query.hasNextPage}
              isFetching={query.isFetchingNextPage}
              onReach={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) {
                  void query.fetchNextPage();
                }
              }}
            />

            {rows.map((row) => (
              <MessageScrollerItem
                key={row.key}
                scrollAnchor={row === rows.at(-1)}
                /* Знімаємо `content-visibility:auto` з рядків. Примітив резервує
                   під пропущений рядок `contain-intrinsic-size: auto 10rem`, а
                   наші рядки — від 20px (роздільник) до ~60px (репліка), тож
                   контейнер отримував ~1200px скролу на ~400px вмісту і стрічка
                   «зависала» вгорі над порожнечею. Сторінка тут 30 рядків —
                   віртуалізація ще не окупається, а її припущення вже шкодить */
                className="[contain-intrinsic-size:auto] [content-visibility:visible]"
              >
                <TranscriptRow
                  row={row}
                  conversation={conversation}
                  viewerId={viewerId}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const EMPTY_OUTBOX: OutboxMessage[] = [];

/** Маркер початку історії — він же тригер довантаження */
function TranscriptStart({
  hasMore,
  isFetching,
  onReach,
}: {
  hasMore: boolean;
  isFetching: boolean;
  onReach: () => void;
}) {
  const { t } = useTranslation('chat');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || isFetching) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReach();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, isFetching, onReach]);

  return (
    <div ref={ref} className="flex justify-center py-1">
      {isFetching ? (
        <Spinner aria-label={t('transcript.loadingOlder')} />
      ) : hasMore ? null : (
        <Marker variant="separator">
          <MarkerContent>{t('transcript.beginning')}</MarkerContent>
        </Marker>
      )}
    </div>
  );
}

function TranscriptRow({
  row,
  conversation,
  viewerId,
  onRetry,
  onDiscard,
}: {
  row: Row;
  conversation: Conversation;
  viewerId: string;
  onRetry: (body: string, clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}) {
  const { t } = useTranslation('chat');

  if (row.kind === 'day') {
    return (
      <Marker variant="separator">
        <MarkerContent>{row.label}</MarkerContent>
      </Marker>
    );
  }

  if (row.kind === 'outbox') {
    return (
      <MessageGroup>
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant={row.entry.state === 'failed' ? 'destructive' : 'default'}>
              <BubbleContent>{row.entry.body}</BubbleContent>
            </Bubble>
            <MessageFooter>
              {row.entry.state === 'failed' ? (
                <span className="flex items-center gap-2">
                  <AlertCircle className="text-destructive" />
                  {t('message.failed')}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      onRetry(row.entry.body, row.entry.clientMessageId);
                    }}
                  >
                    {t('actions.retry')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      onDiscard(row.entry.clientMessageId);
                    }}
                  >
                    {t('actions.discard')}
                  </Button>
                </span>
              ) : (
                t('message.sending')
              )}
            </MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>
    );
  }

  const { message, groupedWithPrevious } = row;

  if (message.kind === 'SYSTEM') {
    const text = systemEntryText(message, t);
    return text ? (
      <Marker variant="separator">
        <MarkerContent>{text}</MarkerContent>
      </Marker>
    ) : null;
  }

  const isOwn = message.senderId === viewerId;
  const author = conversation.participants.find((p) => p.id === message.senderId);
  const label = author?.name ?? author?.email ?? message.senderLabel ?? '';

  return (
    <MessageGroup>
      <Message align={isOwn ? 'end' : 'start'}>
        {!isOwn && (
          <MessageAvatar>
            <Avatar className="size-8">
              {author?.avatarUrl ? <AvatarImage src={author.avatarUrl} alt={label} /> : null}
              <AvatarFallback>{initialsOf(label)}</AvatarFallback>
            </Avatar>
          </MessageAvatar>
        )}
        <MessageContent>
          {/* Автор підписується один раз на групу підряд ідучих реплік */}
          {!isOwn && !groupedWithPrevious && <MessageHeader>{label}</MessageHeader>}
          <Bubble align={isOwn ? 'end' : 'start'} variant={isOwn ? 'default' : 'muted'}>
            <BubbleContent>{message.body}</BubbleContent>
          </Bubble>
          <MessageFooter>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  );
}

/**
 * Плоский список рядків: роздільники дат, групування підряд ідучих реплік
 * одного автора і ненадіслані репліки в самому кінці.
 *
 * Групування рветься не лише зміною автора, а й системним записом і зміною дати —
 * інакше «X додав Y» опинився б усередині групи, підписаної одним іменем.
 */
function buildRows(messages: ChatMessage[], pending: OutboxMessage[]): Row[] {
  const rows: Row[] = [];
  let previousDay: string | null = null;
  let previousSender: string | null = null;

  for (const message of messages) {
    const day = message.createdAt.slice(0, 10);
    if (day !== previousDay) {
      rows.push({ kind: 'day', key: `day-${day}`, label: formatDate(message.createdAt) });
      previousDay = day;
      previousSender = null;
    }

    const sender = message.kind === 'SYSTEM' ? null : (message.senderId ?? message.senderLabel);
    rows.push({
      kind: 'message',
      key: message.id,
      message,
      groupedWithPrevious: sender !== null && sender === previousSender,
    });
    previousSender = sender;
  }

  for (const entry of pending) {
    rows.push({ kind: 'outbox', key: `outbox-${entry.clientMessageId}`, entry });
  }

  return rows;
}
