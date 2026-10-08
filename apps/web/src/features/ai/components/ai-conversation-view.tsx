import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SendIcon, SquareIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiMessageResponse } from '@saas-skeleton/contracts';
import { AI_MAX_INPUT_CHARS, AI_QUOTA_EXCEEDED_CODE } from '@saas-skeleton/contracts';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { useAiAsk, useAiCancel } from '../../../api/generated/api';
import { invalidateAiConversations } from '../ai-queries';
import { Markdown } from './markdown';
import { AiCitations } from './ai-citations';

export type AiConversationVariant = 'panel' | 'page';

interface AiConversationViewProps {
  messages: readonly AiMessageResponse[];
  /**
   * `panel` — вузька права колонка шела; `page` — центр сторінки асистента: та сама
   * стрічка, але колонкою читабельної ширини посередині, а не на всю ширину екрана
   */
  variant: AiConversationVariant;
  /**
   * Замість композера — що показати внизу. Для минулої (RETIRED) розмови: питання в неї
   * не йдуть, поки її не активують, тож композер підмінюється дією «продовжити»
   */
  readOnlyFooter?: ReactNode;
}

/**
 * Вміст розмови з асистентом — розкриття «це AI», стрічка і композер. Без оболонки:
 * її дає місце, куди розмову вставили (бічна панель `AiPanel` або сторінка
 * `/assistant`). Дані приходять пропом, тож той самий вигляд малює і поточну розмову
 * (живий кеш, у який пише стрім), і минулу з історії.
 */
export function AiConversationView({ messages, variant, readOnlyFooter }: AiConversationViewProps) {
  const { t } = useTranslation('ai');
  const viewportRef = useRef<HTMLDivElement>(null);
  const isPage = variant === 'page';

  // Стрічка тримається біля низу, поки відповідь росте — інакше текст
  // «тікав» би за нижній край на кожному чанку
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [messages]);

  const column = isPage ? 'mx-auto w-full max-w-3xl px-6' : 'px-4';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Розкриття «це AI» — ПОСТІЙНЕ і всередині самої взаємодії, а не в умовах
        використання: ст. 50 EU AI Act (діє з 2026-08-02) вимагає, щоб це було
        помітно в момент спілкування. Тому не тост, не одноразова підказка
      */}
      <p className="shrink-0 border-b border-border py-2 text-xs text-muted-foreground">
        <span className={cn('block', column)}>{t('disclosure')}</span>
      </p>

      <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
        <div className={cn('flex flex-col gap-4 py-4', column, isPage && 'py-6')}>
          {messages.length === 0 ? (
            <div className={cn('text-center', isPage ? 'pt-16' : 'pt-6')}>
              <p className={cn('font-medium', isPage ? 'text-base' : 'text-sm')}>
                {t('empty.title')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('empty.hint')}</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageRow key={message.id} message={message} variant={variant} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className={cn('shrink-0 border-t border-border', isPage ? 'py-4' : 'p-3')}>
        <div className={cn(isPage && column)}>
          {readOnlyFooter ?? <AiComposer messages={messages} variant={variant} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Композер ПОТОЧНОЇ розмови: питання завжди йде в активну (`POST /ai/conversation/
 * messages` без id), тож і рендериться він лише там, де показано саме її.
 */
function AiComposer({
  messages,
  variant,
}: {
  messages: readonly AiMessageResponse[];
  variant: AiConversationVariant;
}) {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const ask = useAiAsk();
  const cancel = useAiCancel();
  const [draft, setDraft] = useState('');
  // ai-1d, design.md D9: стан «квота вичерпана» — окремий від generic toast-шляху,
  // бо 400 не потрапляє в isGlobalApiError() і композер має показати це явно
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const pending = messages.find((message) => message.role === 'ASSISTANT' && isInFlight(message));

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || pending) {
      return;
    }
    setDraft('');
    setQuotaExceeded(false);
    ask.mutate(
      { data: { text } },
      {
        onError: (error) => {
          const parsed = parseApiError(error);
          if (parsed.fieldErrors.some((fieldError) => fieldError.code === AI_QUOTA_EXCEEDED_CODE)) {
            setQuotaExceeded(true);
          }
        },
        onSettled: () => {
          void invalidateAiConversations(queryClient);
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      {quotaExceeded && (
        <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {t('quota.exceeded')}
        </p>
      )}
      <Textarea
        value={draft}
        maxLength={AI_MAX_INPUT_CHARS}
        rows={variant === 'page' ? 3 : 2}
        placeholder={t('composer.placeholder')}
        className="resize-none"
        disabled={quotaExceeded}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter шле, Shift+Enter переносить рядок — очікувана поведінка композера
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(event);
          }
        }}
      />
      <div className="mt-2 flex justify-end">
        {pending ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              cancel.mutate({ id: pending.id });
            }}
          >
            <SquareIcon />
            {t('composer.stop')}
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            disabled={draft.trim().length === 0 || ask.isPending || quotaExceeded}
          >
            <SendIcon />
            {t('composer.send')}
          </Button>
        )}
      </div>
    </form>
  );
}

function isInFlight(message: AiMessageResponse): boolean {
  return message.status === 'PENDING' || message.status === 'STREAMING';
}

function MessageRow({
  message,
  variant,
}: {
  message: AiMessageResponse;
  variant: AiConversationVariant;
}) {
  const { t } = useTranslation('ai');

  if (message.role === 'USER') {
    return (
      <div
        className={cn(
          'self-end rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground',
          variant === 'page' ? 'ml-16 max-w-[80%]' : 'ml-6',
        )}
      >
        {message.content}
      </div>
    );
  }

  return (
    <div className="mr-2">
      {message.status === 'PENDING' && message.content.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('message.thinking')}</p>
      ) : (
        <Markdown>{message.content}</Markdown>
      )}

      <AiCitations messageId={message.id} citations={message.citations} />

      {message.status === 'FAILED' && (
        <p className="mt-1 text-xs text-destructive">
          {t(`errorCodes.${message.errorCode ?? 'INTERNAL'}` as 'errorCodes.INTERNAL')}
        </p>
      )}
      {message.status === 'CANCELLED' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('message.cancelled')}</p>
      )}
    </div>
  );
}
