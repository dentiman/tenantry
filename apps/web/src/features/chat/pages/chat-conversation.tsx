import { useCallback } from 'react';
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
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { useChatFindOne } from '../../../api/generated/api';
import { useAuthStore } from '../../auth/stores/auth.store';
import { useChatOutboxStore } from '../stores/chat-outbox.store';
import { ChatComposer } from '../components/chat-composer';
import { ChatTranscript } from '../components/chat-transcript';
import { NewConversationDialog } from '../components/new-conversation-dialog';
import { conversationLabel } from '../components/chat-labels';
import { useSendMessage } from '../components/use-chat';
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
  const discard = useChatOutboxStore((state) => state.discard);

  const onSend = useCallback(
    (body: string) => {
      send(body, randomUUID());
    },
    [send],
  );

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
        subtitle={t('page.participants', { count: conversation.participants.length })}
        actions={<NewConversationDialog />}
      />
      {/* `h-[calc(100vh-3.5rem)]` компенсує `h-14` хедера шела — той самий
          прийом, що в календарі. Без нього сторінка
          у `bleed`-обгортці (`min-h-full`, висота НЕ визначена) міряється
          вмістом, і композер повисає посеред екрана замість того, щоб
          триматись низу, а стрічка не отримує власної області прокрутки */}
      <div className="flex h-[calc(100vh-3.5rem)] min-h-[20rem] flex-col">
        <ChatTranscript
          conversation={conversation}
          viewerId={viewerId}
          onRetry={retry}
          onDiscard={onDiscard}
        />
        <ChatComposer onSend={onSend} />
      </div>
    </>
  );
}
