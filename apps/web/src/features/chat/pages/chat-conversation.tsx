import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { MessagesSquare } from 'lucide-react';
import { CLIENT_EVENTS } from '@saas-skeleton/contracts';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { ContextPanelPortal } from '@saas-skeleton/ui/components/context-panel-slot';
import { useChatFindOne } from '../../../api/generated/api';
import { useAuthStore } from '../../auth/stores/auth.store';
import { useChatOutboxStore } from '../stores/chat-outbox.store';
import { ChatComposer } from '../components/chat-composer';
import { TemplateDialog } from '../components/template-dialog';
import { ConversationControls } from '../components/conversation-controls';
import { effectiveMode, type ComposerMode } from '../components/delivery-state';
import { ChatTranscript } from '../components/chat-transcript';
import { ContactPanel } from '../components/contact-panel';
import { NewConversationDialog } from '../components/new-conversation-dialog';
import { conversationLabel } from '../components/chat-labels';
import { TypingIndicator } from '../components/typing-indicator';
import { useResendMessage, useSendMessage } from '../components/use-chat';
import { emitChatEvent } from '../realtime/chat-socket';
import { watchConversation } from '../realtime/chat-subscriptions';
import { randomUUID } from '../../../lib/uuid';

/**
 * Відкрита розмова. Свіжість — з сокета (`realtime/chat-sync.ts`, docs/chat.md §4.8):
 * чужа репліка, склад учасників і рух курсора з іншої вкладки приходять самі. Перечитування
 * на фокус вікна лишилось страховкою, а не механізмом; кнопки «Оновити» немає.
 */
export function ChatConversationPage() {
  const { t } = useTranslation('chat');
  // `strict: false` — роут-дерево зібране на id-батькові (`appRoute`), тож
  // типізований `from` тут не сходиться; параметр однаково один
  const { conversationId = '' } = useParams({ strict: false });
  const viewerId = useAuthStore((state) => state.user?.id ?? '');

  const query = useChatFindOne(conversationId, { query: { meta: { silentError: true } } });
  const { send, retry } = useSendMessage(conversationId);
  const resend = useResendMessage(conversationId);
  const discard = useChatOutboxStore((state) => state.discard);
  // Режим композера в клієнтській розмові; діє через `effectiveMode` (закрите вікно → нотатка)
  const [requestedMode, setRequestedMode] = useState<ComposerMode>('reply');

  const mode = effectiveMode(requestedMode, query.data?.canReply ?? true);
  const onSend = useCallback(
    (body: string) => {
      send(body, randomUUID(), mode === 'note' ? 'INTERNAL' : 'PUBLIC');
    },
    [send, mode],
  );
  const onResend = useCallback(
    (messageId: string) => {
      resend.mutate(messageId);
    },
    [resend],
  );

  // Розмова відкрита → сервер знає, що її дивляться (`chat.subscribe.v1`); закрита чи змінена
  // → знімається. Перепідписку після розриву робить сам спостерігач. Відмова нічого не ламає:
  // без підписки стрічка й список оновлюються, зникає лише «друкує…» інших
  useEffect(() => {
    if (conversationId === '') {
      return;
    }
    return watchConversation(conversationId);
  }, [conversationId]);

  const onTyping = useCallback(() => {
    void emitChatEvent(CLIENT_EVENTS.chatTyping, { conversationId });
  }, [conversationId]);

  const onDiscard = useCallback(
    (clientMessageId: string) => {
      discard(conversationId, clientMessageId);
    },
    [conversationId, discard],
  );

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner aria-label={t('transcript.loading')} />
      </div>
    );
  }

  // Недоступна або неіснуюча розмова — однакова відповідь сервера (404), тож і
  // екран один: area лишається придатною до роботи, а не падає
  if (query.isError || !query.data) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare />
          </EmptyMedia>
          <EmptyTitle>{t('page.unavailable.title')}</EmptyTitle>
          <EmptyDescription>{t('page.unavailable.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const conversation = query.data;
  const label = conversationLabel(conversation, viewerId, t);
  const isCustomer = conversation.contact !== null;

  return (
    <>
      {/* Ідентичність розмови живе РІВНО в хедері шела — там же, де в списків
          (`page-header.tsx`: «заголовок двічі» був знятий саме як помилка).
          Власна смуга заголовка всередині сторінки прибрана: вона повторювала
          крихти, коштувала ще один рядок вертикалі над стрічкою і давала другу
          лінію одразу під лінією хедера. Кількість учасників стала
          підзаголовком, створення розмови — дією хедера */}
      <PageHeader
        label="ChatConversationPage"
        breadcrumbs={[{ label: t('title'), to: '/chat' }, { label }]}
        subtitle={
          conversation.contact
            ? (conversation.contact.channelNumber ?? undefined)
            : t('page.participants', { count: conversation.participants.length })
        }
        actions={isCustomer ? undefined : <NewConversationDialog />}
      />
      {/* `h-[calc(100vh-3.5rem)]` компенсує `h-14` хедера шела — той самий
          прийом, що в календарі. Без нього сторінка
          у `bleed`-обгортці (`min-h-full`, висота НЕ визначена) міряється
          вмістом, і композер повисає посеред екрана замість того, щоб
          триматись низу, а стрічка не отримує власної області прокрутки */}
      <div className="flex h-[calc(100vh-3.5rem)] min-h-[20rem] flex-col">
        {/* Статус і відповідальний — над стрічкою, а не в хедері шела: там для них немає місця поруч
            з меню користувача, а до розмови вони належать (CHAT-2b) */}
        {isCustomer && (
          <div className="flex shrink-0 justify-end border-b px-4 py-2">
            <ConversationControls conversation={conversation} />
          </div>
        )}
        <ChatTranscript
          conversation={conversation}
          viewerId={viewerId}
          onRetry={retry}
          onDiscard={onDiscard}
          onResend={onResend}
        />
        {isCustomer ? (
          <ChatComposer
            onSend={onSend}
            customer={{
              mode,
              canReply: conversation.canReply,
              windowEndsAt: conversation.replyWindowEndsAt,
              onModeChange: setRequestedMode,
              receiptsMissing: conversation.contact ? !conversation.contact.deliveryReceipts : false,
              ...(conversation.contact?.templates && {
                templateSlot: <TemplateDialog conversationId={conversationId} />,
              }),
            }}
          />
        ) : (
          <>
            <TypingIndicator conversation={conversation} />
            <ChatComposer onSend={onSend} onTyping={onTyping} />
          </>
        )}
      </div>
      {conversation.contact && (
        <ContextPanelPortal contentKey={conversation.contact.id} label="ChatConversationPage">
          <ContactPanel contactId={conversation.contact.id} />
        </ContextPanelPortal>
      )}
    </>
  );
}
