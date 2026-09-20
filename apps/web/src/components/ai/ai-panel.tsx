import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BotIcon, RotateCcwIcon, SendIcon, SquareIcon, XIcon } from 'lucide-react';
import type { AiMessageResponse } from '@saas-skeleton/contracts';
import { AI_MAX_INPUT_CHARS } from '@saas-skeleton/contracts';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { ResizeHandle } from '@saas-skeleton/ui/components/resize-handle';
import {
  useAiAsk,
  useAiCancel,
  useAiConversation,
  useAiReset,
  getAiConversationQueryKey,
} from '../../api/generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useAiPanelStore } from '../../stores/ai-panel.store';
import { Markdown } from './markdown';

/**
 * Панель AI-асистента — ПʼЯТА колонка шела, найправіша.
 *
 * Геометрія дзеркалить `ContextPanelSlot`: сусід `SidebarInset`, від верху вікна
 * до низу, власна шапка `h-14` з `border-b` — щоб чотири шапки (рейл, колонка
 * area, хедер контенту, ця) складали одну неперервну лінію через усе вікно.
 * Поверхня `bg-sidebar`, а не `bg-background`: бічні колонки — шасі шела,
 * полотном лишається лише контент посередині.
 *
 * НЕ `Sheet`: панель не накриває сторінку, а стискає її, і людина далі працює
 * з контентом, поки асистент відповідає. Саме тому вона й переживає навігацію —
 * її стан живе в сторі поза роутером.
 */
export function AiPanel() {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const close = useAiPanelStore((state) => state.close);

  const { data: conversation } = useAiConversation();
  const ask = useAiAsk();
  const reset = useAiReset();
  const cancel = useAiCancel();

  const [draft, setDraft] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);

  const messages = conversation?.messages ?? [];
  const pending = messages.find(
    (message) => message.role === 'ASSISTANT' && isInFlight(message),
  );

  // Стрічка тримається біля низу, поки відповідь росте — інакше текст
  // «тікав» би за нижній край на кожному чанку
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [messages]);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || pending) {
      return;
    }
    setDraft('');
    ask.mutate(
      { data: { text } },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: getAiConversationQueryKey() });
        },
      },
    );
  };

  return (
    <aside
      data-slot="ai-panel"
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar text-sidebar-foreground',
        'fixed inset-y-0 right-0 z-30 w-[min(22rem,100vw)] shadow-lg',
        'md:sticky md:inset-y-auto md:top-0 md:right-auto md:z-auto md:h-svh md:w-[var(--ai-panel-width,22rem)] md:shadow-none',
      )}
    >
      <ResizeHandle
        edge="left"
        grow="left"
        cssVar="--ai-panel-width"
        storageKey="app-shell:ai-panel-width"
        defaultWidthPx={352}
        minWidthPx={320}
        maxRatio={0.45}
        className="hidden md:block"
      />

      {/* Та сама h-14 з border-b, що в решти трьох шапок вікна */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <BotIcon className="size-4 text-icon" aria-hidden />
        <span className="flex-1 truncate text-sm font-medium">{t('title')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('newConversation')}
          title={t('newConversation')}
          disabled={reset.isPending || messages.length === 0}
          onClick={() => {
            reset.mutate(undefined, {
              onSettled: () => {
                void queryClient.invalidateQueries({ queryKey: getAiConversationQueryKey() });
              },
            });
          }}
        >
          <RotateCcwIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('close')}
          onClick={close}
        >
          <XIcon />
        </Button>
      </header>

      {/*
        Розкриття «це AI» — ПОСТІЙНЕ і всередині самої взаємодії, а не в умовах
        використання: ст. 50 EU AI Act (діє з 2026-08-02) вимагає, щоб це було
        помітно в момент спілкування. Тому не тост, не одноразова підказка
      */}
      <p className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {t('disclosure')}
      </p>

      <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.length === 0 ? (
            <div className="pt-6 text-center">
              <p className="text-sm font-medium">{t('empty.title')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('empty.hint')}</p>
            </div>
          ) : (
            messages.map((message) => <MessageRow key={message.id} message={message} />)
          )}
        </div>
      </ScrollArea>

      <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
        <Textarea
          value={draft}
          maxLength={AI_MAX_INPUT_CHARS}
          rows={2}
          placeholder={t('composer.placeholder')}
          className="resize-none"
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
            <Button type="submit" size="sm" disabled={draft.trim().length === 0 || ask.isPending}>
              <SendIcon />
              {t('composer.send')}
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}

function isInFlight(message: AiMessageResponse): boolean {
  return message.status === 'PENDING' || message.status === 'STREAMING';
}

function MessageRow({ message }: { message: AiMessageResponse }) {
  const { t } = useTranslation('ai');

  if (message.role === 'USER') {
    return (
      <div className="ml-6 self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
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
