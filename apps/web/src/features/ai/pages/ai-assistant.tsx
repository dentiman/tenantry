import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from '@tanstack/react-router';
import { HistoryIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AI_CONVERSATION_TITLE_CHARS, type AiMessageResponse } from '@saas-skeleton/contracts';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import {
  getAiConversationQueryKey,
  useAiActivate,
  useAiConversation,
  useAiConversationById,
} from '../../../api/generated/api';
import { invalidateAiConversations } from '../ai-queries';
import { AiConversationView } from '../components/ai-conversation-view';
import {
  AiDeleteAllButton,
  AiNewConversationButton,
} from '../components/ai-conversation-actions';
import { useAiEnabled } from '../components/use-ai-enabled';

/** `/assistant` — поточна розмова на всю сторінку */
export function AiAssistantPage() {
  return <AiAssistantScreen />;
}

/** `/assistant/$conversationId` — розмова з історії (поточна або минула) */
export function AiAssistantConversationPage() {
  // `strict: false` — роут-дерево зібране на id-батькові (`appRoute`), як і в чаті
  const { conversationId } = useParams({ strict: false });
  return <AiAssistantScreen conversationId={conversationId} />;
}

/**
 * Сторінка асистента: та сама розмова, що в бічній панелі (`AiConversationView`), але в
 * центрі шела, з історією в колонці area (`AssistantSidebar`).
 *
 * Дві гілки, і різниця між ними — не вигляд, а джерело даних:
 * - ПОТОЧНА розмова читається з `useAiConversation()` — того самого кешу, у який пише
 *   стрім (`ai-sync.ts`), тож відповідь росте тут так само, як у панелі, без жодного
 *   нового коду стріму. Тому й відкрита за id поточна розмова йде цією гілкою;
 * - МИНУЛА (RETIRED) читається за id і лише для читання: відповідь у ній не генерується
 *   (воркер закриває такі як CANCELLED), тож живий кеш їй не потрібен. Писати в неї —
 *   через «продовжити»: вона стає поточною, і сторінка сама переходить у першу гілку.
 */
function AiAssistantScreen({ conversationId }: { conversationId?: string }) {
  const { t } = useTranslation('ai');
  const navigate = useNavigate();
  const isEnabled = useAiEnabled();

  const current = useAiConversation({ query: { enabled: isEnabled } });
  const isCurrent = conversationId === undefined || conversationId === current.data?.id;
  const past = useAiConversationById(conversationId ?? '', {
    query: {
      enabled: isEnabled && !isCurrent && current.data !== undefined,
      meta: { silentError: true },
    },
  });

  const goToCurrent = (): void => {
    void navigate({ to: '/assistant' });
  };

  if (!isEnabled) {
    return <Unavailable title={t('page.disabled.title')} description={t('page.disabled.description')} />;
  }

  const query = isCurrent ? current : past;
  if (query.isLoading || current.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner aria-label={t('page.loading')} />
      </div>
    );
  }

  // Чужа, неіснуюча або вже видалена — однакова 404 сервера, тож і екран один
  if (query.isError || !query.data) {
    return (
      <Unavailable
        title={t('page.unavailable.title')}
        description={t('page.unavailable.description')}
      />
    );
  }

  const conversation = query.data;
  const title = titleOf(conversation.messages) ?? t('page.newTitle');

  return (
    <>
      <PageHeader
        label="AiAssistantPage"
        breadcrumbs={[{ label: t('title'), to: '/assistant' }, { label: title }]}
        subtitle={isCurrent ? undefined : t('page.pastSubtitle')}
        actions={
          <>
            <AiNewConversationButton
              size="icon-sm"
              disabled={isCurrent && conversation.messages.length === 0}
              onDone={goToCurrent}
            />
            <AiDeleteAllButton size="icon-sm" onDone={goToCurrent} />
          </>
        }
      />
      {/* `h-[calc(100vh-3.5rem)]` компенсує `h-14` хедера шела — той самий прийом, що
          в розмові чату: інакше в `bleed`-обгортці композер повис би посеред екрана */}
      <div className="flex h-[calc(100vh-3.5rem)] min-h-[20rem] flex-col">
        <AiConversationView
          messages={conversation.messages}
          variant="page"
          readOnlyFooter={isCurrent ? undefined : <ContinueFooter conversationId={conversation.id} />}
        />
      </div>
    </>
  );
}

/**
 * Замість композера в минулій розмові. Питання завжди йде в ПОТОЧНУ розмову, тож писати
 * сюди можна лише зробивши її поточною — і це явна дія, а не побічний ефект відправки.
 */
function ContinueFooter({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const activate = useAiActivate();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <HistoryIcon className="size-4 text-icon-muted" aria-hidden />
        {t('page.pastNotice')}
      </p>
      <Button
        size="sm"
        disabled={activate.isPending}
        onClick={() => {
          activate.mutate(
            { id: conversationId },
            {
              onSuccess: (conversation) => {
                // Відповідь і є новий стан поточної розмови — кладемо її в кеш одразу,
                // щоб сторінка перемкнулась у живу гілку без проміжного спінера
                queryClient.setQueryData(getAiConversationQueryKey(), conversation);
              },
              onSettled: () => {
                void invalidateAiConversations(queryClient);
              },
            },
          );
        }}
      >
        {activate.isPending ? <Spinner /> : <PlayIcon />}
        {t('page.continue')}
      </Button>
    </div>
  );
}

function Unavailable({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Та сама назва, що в історії: зріз першого питання (сервер — `toAiConversationSummary`) */
function titleOf(messages: readonly AiMessageResponse[]): string | undefined {
  const first = messages.find((message) => message.role === 'USER');
  const flat = first?.content.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > AI_CONVERSATION_TITLE_CHARS
    ? `${flat.slice(0, AI_CONVERSATION_TITLE_CHARS - 1)}…`
    : flat;
}
