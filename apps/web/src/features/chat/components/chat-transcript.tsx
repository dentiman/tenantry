import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
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
import { formatDate, formatDateTime, formatTime } from '@saas-skeleton/ui/lib/format';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { CHAT_COLUMN } from './chat-layout';
import { useChatOutboxStore, type OutboxMessage } from '../stores/chat-outbox.store';
import { initialsOf, systemEntryText } from './chat-labels';
import { canResend, deliveryIcon, failureKey, isDeliverable } from './delivery-state';
import { ReadOnViewTracker } from './read-on-view-tracker';
import { flattenTranscript, useMarkRead, useTranscript, type ChatMessage } from './use-chat';
import type { Conversation } from './use-chat';

interface ChatTranscriptProps {
  conversation: Conversation;
  viewerId: string;
  onRetry: (body: string, clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  /** Повторити відправку невдалого вихідного клієнтові (CHAT-2b) */
  onResend: (messageId: string) => void;
}

/** Рядок стрічки: або серверне повідомлення, або ще ненадіслане з черги */
export type Row =
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
  onResend,
}: ChatTranscriptProps) {
  const { t } = useTranslation('chat');
  const query = useTranscript(conversation.id);
  const markRead = useMarkRead(conversation.id);
  const pending = useChatOutboxStore((state) => state.pending[conversation.id] ?? EMPTY_OUTBOX);

  const messages = useMemo(
    () => flattenTranscript(query.data?.pages),
    [query.data?.pages],
  );

  // Курсор прочитаного рухає `ReadOnViewTracker` (нижче), а не зміна даних: «прочитано» —
  // це «дивилась людина», а не «репліка долетіла» (docs/chat.md §4.8.2). Стартова позиція —
  // та, що вже підтвердив сервер, щоб її не повторювати
  const newestSeq = messages.at(-1)?.seq ?? 0;

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
    <MessageScrollerProvider autoScroll>
      <ReadOnViewTracker
        key={conversation.id}
        newestSeq={newestSeq}
        initialReportedSeq={conversation.lastReadSeq}
        onRead={markRead}
      />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-4 py-3">
          {/* `justify-end` — коротка розмова притискається до композера, як у
              будь-якому месенджері. Коли вміст переростає вʼюпорт, вільного
              місця немає і правило нічого не змінює */}
          <MessageScrollerContent className={cn('justify-end gap-4', CHAT_COLUMN)}>
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

            <TranscriptRows
              rows={rows}
              conversation={conversation}
              viewerId={viewerId}
              onRetry={onRetry}
              onDiscard={onDiscard}
              onResend={onResend}
            />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const EMPTY_OUTBOX: OutboxMessage[] = [];

/**
 * Чи це власна репліка людини (ненадіслана з черги чи щойно підтверджена). Чиста функція —
 * правило перевіряється тестом без DOM.
 */
export function isOwnRow(row: Row, viewerId: string): boolean {
  return (
    row.kind === 'outbox' ||
    (row.kind === 'message' &&
      row.message.kind === 'TEXT' &&
      (row.message.senderId === viewerId || row.message.direction === 'OUTBOUND'))
  );
}

/**
 * Рядки стрічки. Окремий компонент, бо `scrollToEnd` віддає хук примітива, а той працює лише під
 * `MessageScrollerProvider`.
 *
 * Прокрутка тут — «слідувати за низом» (`autoScroll` на провайдері), а НЕ якір. Раніше останній
 * рядок позначався `scrollAnchor`: примітив вирівнює новий якір по ВЕРХУ вʼюпорта й додає під
 * ним порожній спейсер (так роблять AI-чати, де відповідь росте вниз). У месенджері це виглядало
 * як стрибок: щойно надіслане повідомлення зʼявлялося нагорі, під ним ~600px порожнечі (виміряно
 * в 0.2b: 64px від верху, спейсер 615px). Тепер:
 *  - хто внизу, той і лишається внизу: нове повідомлення стає рівно під попередніми;
 *  - хто прогорнув історію вгору, того ніщо не смикає (режим «вільної прокрутки»);
 *  - власну репліку примітив не знає, тож її докручуємо явно: надіславши, людина чекає побачити її.
 */
function TranscriptRows({
  rows,
  conversation,
  viewerId,
  onRetry,
  onDiscard,
  onResend,
}: {
  rows: Row[];
  conversation: Conversation;
  viewerId: string;
  onRetry: ChatTranscriptProps['onRetry'];
  onDiscard: ChatTranscriptProps['onDiscard'];
  onResend: ChatTranscriptProps['onResend'];
}) {
  const { scrollToEnd } = useMessageScroller();
  const last = rows.at(-1);
  const lastKey = last?.key;
  const lastIsOwn = last ? isOwnRow(last, viewerId) : false;
  // Ключ останнього рядка, на якому вже відпрацювали: перший рендер (відкриття розмови) не
  // докручуємо — стартову позицію («кінець») тримає `defaultScrollPosition` примітива
  const handledKey = useRef<string | undefined>(lastKey);

  useEffect(() => {
    if (lastKey === handledKey.current) {
      return;
    }
    handledKey.current = lastKey;
    if (lastIsOwn) {
      scrollToEnd({ behavior: 'auto' });
    }
  }, [lastKey, lastIsOwn, scrollToEnd]);

  return rows.map((row) => (
    <MessageScrollerItem
      key={row.key}
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
        onResend={onResend}
      />
    </MessageScrollerItem>
  ));
}

/**
 * Службові рядки стрічки — роздільник дати, «початок розмови», системні записи
 * («X додав Y») — тихіші за репліки: менший кегль і на тон слабший колір.
 *
 * Базовий `Marker` дає `text-sm text-muted-foreground`, тобто рівно ту саму вагу,
 * що й текст репліки. Але це не зміст розмови, а підписи до неї: читають їх раз,
 * а стоять вони між кожними двома днями. `/70` — той самий четвертий рівень
 * тексту, що в підзаголовка сторінки (`page-header.tsx`); окремого токена під
 * нього не заводимо з тієї ж причини — рівень на двох споживачів це виняток зі
 * шкали, а не її щабель. Риски роздільника лишаються `border`: вони вже
 * найслабші в темі.
 */
const TRANSCRIPT_MARKER = 'text-xs text-muted-foreground/70';

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
        <Marker variant="separator" className={TRANSCRIPT_MARKER}>
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
  onResend,
}: {
  row: Row;
  conversation: Conversation;
  viewerId: string;
  onRetry: (body: string, clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onResend: (messageId: string) => void;
}) {
  const { t } = useTranslation('chat');

  if (row.kind === 'day') {
    return (
      <Marker variant="separator" className={TRANSCRIPT_MARKER}>
        <MarkerContent>{row.label}</MarkerContent>
      </Marker>
    );
  }

  if (row.kind === 'outbox') {
    const isFailed = row.entry.state === 'failed';
    return (
      <MessageGroup>
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant={isFailed ? 'destructive' : 'default'}>
              <BubbleBody
                body={row.entry.body}
                tone={isFailed ? 'failed' : 'own'}
                meta={
                  <>
                    {/* Годинник замість рядка «Sending…» — форма месенджера:
                        стан репліки читається там же, де її час, і не додає
                        стрічці ще одного рядка. Для читача з екранного диктора
                        іконка нічого не каже, тому текст лишається в sr-only */}
                    {!isFailed && (
                      <>
                        <Clock className="size-3" />
                        <span className="sr-only">{t('message.sending')}</span>
                      </>
                    )}
                    <MessageTime iso={row.entry.createdAt} />
                  </>
                }
              />
            </Bubble>
            {/* Футер лишається ТІЛЬКИ у провалу: там не мітка, а дії, і їм
                місце під бульбашкою, а не всередині неї */}
            {isFailed && (
              <MessageFooter>
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
              </MessageFooter>
            )}
          </MessageContent>
        </Message>
      </MessageGroup>
    );
  }

  const { message, groupedWithPrevious } = row;

  if (message.kind === 'SYSTEM') {
    const text = systemEntryText(message, t);
    return text ? (
      <Marker variant="separator" className={TRANSCRIPT_MARKER}>
        <MarkerContent>{text}</MarkerContent>
      </Marker>
    ) : null;
  }

  // Вихідне клієнтові лежить на боці команди незалежно від того, хто з колег його написав
  const isOutbound = message.direction === 'OUTBOUND';
  const isOwn = message.senderId === viewerId || isOutbound;
  const isNote = message.visibility === 'INTERNAL';
  const deliverable = isDeliverable(message);
  const author = conversation.participants.find((p) => p.id === message.senderId);
  const label = author?.name ?? author?.email ?? message.senderLabel ?? '';
  const showFailure = deliverable && message.status === 'FAILED' && message.failure !== null;

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
          {/* Автор підписується один раз на групу підряд ідучих реплік; нотатка — завжди, з позначкою */}
          {isNote ? (
            <MessageHeader>
              {t('message.internalNote')} · {label}
            </MessageHeader>
          ) : (
            (!isOwn || (isOutbound && message.senderId !== viewerId)) &&
            !groupedWithPrevious && <MessageHeader>{label}</MessageHeader>
          )}
          <Bubble
            align={isOwn ? 'end' : 'start'}
            variant={isNote ? 'muted' : isOwn ? 'default' : 'muted'}
            className={isNote ? 'border border-dashed border-border' : undefined}
          >
            <BubbleBody
              body={message.body ?? ''}
              tone={isNote ? 'other' : isOwn ? 'own' : 'other'}
              meta={
                <>
                  <MessageTime iso={message.createdAt} />
                  {deliverable && <DeliveryMark status={message.status} />}
                </>
              }
            />
          </Bubble>
          {showFailure && message.failure && (
            <MessageFooter>
              <span className="flex items-center gap-2">
                <AlertCircle className="text-destructive" />
                {t(failureKey(message.failure), { defaultValue: message.failure.title })}
                {canResend(message) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      onResend(message.id);
                    }}
                  >
                    {t('actions.resend')}
                  </Button>
                )}
              </span>
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    </MessageGroup>
  );
}

/**
 * Стан доставки вихідного поруч із часом (CHAT-2b): годинник — у черзі/відправляється, одна галочка —
 * прийнято провайдером, дві — доставлено, дві акцентні — прочитано, знак — не доставлено. Іконка
 * німа для диктора, тому текст стану лишається в sr-only.
 */
function DeliveryMark({ status }: { status: ChatMessage['status'] }) {
  const { t } = useTranslation('chat');
  const icon = deliveryIcon(status);
  const text = t(`delivery.${icon}`);
  return (
    <>
      {icon === 'pending' && <Clock className="size-3" />}
      {icon === 'sent' && <Check className="size-3" />}
      {icon === 'delivered' && <CheckCheck className="size-3" />}
      {icon === 'read' && <CheckCheck className="size-3 text-sky-300" />}
      {icon === 'failed' && <AlertCircle className="size-3 text-destructive" />}
      <span className="sr-only">{text}</span>
    </>
  );
}

/** Кегль мітки один на всі стани — вона однакова і в чужій, і в своїй бульбашці */
const META_CLASS = 'text-[0.6875rem] leading-none font-normal tabular-nums';

const META_TONE = {
  own: 'text-primary-foreground/70',
  other: 'text-muted-foreground',
  failed: 'text-destructive/70',
} as const;

/**
 * Текст репліки з мітками (час, стан) У ПРАВОМУ НИЖНЬОМУ КУТІ САМОЇ БУЛЬБАШКИ —
 * форма Telegram / WhatsApp / iMessage, а не окремий рядок `MessageFooter` під
 * нею.
 *
 * ── Чому не футер ─────────────────────────────────────────────────────────────
 * Футер — блок під бульбашкою: кожна репліка коштувала б ~18px вертикалі й
 * власного рядка, а стрічка з коротких «ок» перетворювалась на драбину з
 * підписів. Час — атрибут репліки, а не подія стрічки, тож він належить плитці.
 * Заразом звільняється місце під статуси доставки (`sent → delivered → read`,
 * docs/chat.md §4.14.1): вони стануть поруч із часом, як у будь-якому
 * месенджері, а не третім рядком.
 *
 * ── Механіка: чому потрібна невидима розпірка ─────────────────────────────────
 * Мітка стоїть `absolute` у куті, тобто випадає з потоку і НЕ розсуває текст.
 * Щоб останній рядок не заліз під неї, одразу за текстом у потік ставиться
 * невидима копія тієї самої мітки. Вона має рівно ту саму ширину (той самий
 * вміст, той самий кегль — не число «на око»), тож поводиться як у месенджерах:
 *   • хвіст останнього рядка короткий → мітка стає поруч, у тому ж рядку;
 *   • хвіст довгий → розпірка переноситься сама, бульбашка отримує зайвий
 *     короткий рядок, і мітка сідає в нього.
 * Розглянуті й відкинуті альтернативи: `flex-wrap` (текст стає flex-елементом і
 * мітка ніколи не стає в один рядок із ЧАСТИНОЮ абзацу), `float` (не працює з
 * `overflow-hidden` бульбашки і ламає перенос довгих слів), вимір ширини в JS
 * (layout-читання на кожну репліку заради сталого `HH:mm`).
 *
 * `select-none` на розпірці — щоб копіювання тексту репліки не тягнуло за собою
 * другий час; `aria-hidden` — щоб диктор не читав його двічі.
 *
 * `whitespace-pre-wrap`: композер приймає перенос рядка (Shift+Enter), і без
 * цього багаторядкова репліка склеювалась в один абзац.
 */
function BubbleBody({
  body,
  meta,
  tone,
}: {
  body: string;
  meta: ReactNode;
  tone: keyof typeof META_TONE;
}) {
  const metaClass = cn('inline-flex items-center gap-1', META_CLASS, META_TONE[tone]);

  return (
    <BubbleContent className="relative">
      <span className="whitespace-pre-wrap">{body}</span>
      <span aria-hidden className={cn(metaClass, 'invisible ml-2 select-none align-bottom')}>
        {meta}
      </span>
      <span className={cn(metaClass, 'absolute right-3 bottom-2')}>{meta}</span>
    </BubbleContent>
  );
}

/** `title` — повна дата: у стрічці видно тільки `HH:mm`, а день може бути не сьогодні */
function MessageTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {formatTime(iso)}
    </time>
  );
}

/**
 * Плоский список рядків: роздільники дат, групування підряд ідучих реплік
 * одного автора і ненадіслані репліки в самому кінці.
 *
 * Групування рветься не лише зміною автора, а й системним записом і зміною дати —
 * інакше «X додав Y» опинився б усередині групи, підписаної одним іменем.
 *
 * Ненадіслана репліка, чий `clientMessageId` уже є серед повідомлень стрічки, не
 * малюється: сервер її підтвердив (відповіддю або відлунням сокета), а запис у черзі
 * вихідних знімається окремим кроком і може відстати від перечитаної стрічки на
 * кілька мілісекунд. Без цього в цей проміжок вона стояла б у стрічці двічі.
 */
export function buildRows(messages: ChatMessage[], pending: OutboxMessage[]): Row[] {
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

  const confirmed = new Set(messages.map((message) => message.clientMessageId));
  for (const entry of pending) {
    if (confirmed.has(entry.clientMessageId)) {
      continue;
    }
    rows.push({ kind: 'outbox', key: `outbox-${entry.clientMessageId}`, entry });
  }

  return rows;
}
