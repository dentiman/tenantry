import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { activeTypists, useChatTypingStore } from '../stores/chat-typing.store';
import { CHAT_COLUMN } from './chat-layout';
import { describeTypists } from './typing-label';
import type { Conversation } from './use-chat';

/**
 * «Хтось друкує…» над композером (docs/chat.md §4.8.2).
 *
 * Рядок має ФІКСОВАНУ висоту і стоїть у DOM завжди: поява і зникнення тексту не зсувають
 * стрічку й композер. Прострочені записи прибирає тік раз на секунду, який працює, лише
 * доки в сторі є хоч один запис, — порожній екран не тримає таймера.
 */
export function TypingIndicator({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation('chat');
  const entries = useChatTypingStore((state) => state.entries[conversation.id]);
  const prune = useChatTypingStore((state) => state.prune);
  const hasEntries = entries !== undefined;

  useEffect(() => {
    if (!hasEntries) {
      return;
    }
    const timer = setInterval(() => {
      prune();
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [hasEntries, prune]);

  const label = useMemo(
    () =>
      describeTypists(
        activeTypists({ [conversation.id]: entries ?? {} }, conversation.id),
        conversation.participants,
      ),
    [conversation.id, conversation.participants, entries],
  );

  return (
    <div className="shrink-0 px-4" role="status" aria-live="polite">
      <div className={`${CHAT_COLUMN} h-5 truncate text-xs text-muted-foreground`}>
        {label ? t(label.key, label.values) : null}
      </div>
    </div>
  );
}
