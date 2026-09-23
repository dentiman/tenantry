import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { MessagesSquare } from 'lucide-react';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { useChatFindOne } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { useChatOutboxStore } from '../stores/chat-outbox.store';
import { ChatComposer } from '../components/chat/chat-composer';
import { ChatTranscript } from '../components/chat/chat-transcript';
import { conversationLabel } from '../components/chat/chat-labels';
import { useRefreshChat, useSendMessage } from '../components/chat/use-chat';

/**
 * Відкрита розмова. Свіжість без realtime: перечитування на фокус вікна і після
 * надсилання плюс явна кнопка оновлення — фаза CHAT-0.1 свідомо не тримає
 * живого зʼєднання (docs/chat.md §7.4).
 */
export function ChatConversationPage() {
  const { t } = useTranslation('chat');
  // `strict: false` — роут-дерево зібране на id-батькові (`appRoute`), тож
  // типізований `from` тут не сходиться; параметр однаково один
  const { conversationId = '' } = useParams({ strict: false });
  const viewerId = useAuthStore((state) => state.user?.id ?? '');

  const query = useChatFindOne(conversationId, {
    query: { staleTime: 5_000, meta: { silentError: true } },
  });
  const { send, retry } = useSendMessage(conversationId);
  const refresh = useRefreshChat(conversationId);
  const discard = useChatOutboxStore((state) => state.discard);

  const onSend = useCallback(
    (body: string) => {
      send(body, crypto.randomUUID());
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
      <PageBreadcrumbs items={[{ label: t('title'), to: '/chat' }, { label }]} />
      {/* `h-[calc(100vh-3.5rem)]` компенсує `h-14` хедера шела — той самий
          прийом, що в календарі й `playground-architecture`. Без нього сторінка
          у `bleed`-обгортці (`min-h-full`, висота НЕ визначена) міряється
          вмістом, і композер повисає посеред екрана замість того, щоб
          триматись низу, а стрічка не отримує власної області прокрутки */}
      <div className="flex h-[calc(100vh-3.5rem)] min-h-[20rem] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{label}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {t('page.participants', { count: conversation.participants.length })}
            </p>
          </div>
          {/* Явне оновлення: без realtime екран мусить давати спосіб спитати
              сервер, а не робити вигляд, що він живий */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('actions.refresh')}
            onClick={() => {
              void refresh();
            }}
          >
            <RotateCw />
          </Button>
        </header>

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
