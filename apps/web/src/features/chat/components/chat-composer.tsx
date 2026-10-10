import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendHorizontal } from 'lucide-react';
import { CHAT_MAX_MESSAGE_CHARS, CHAT_TYPING_PULSE_MS } from '@saas-skeleton/contracts';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { CHAT_COLUMN } from './chat-layout';

/** Стеля автовисоти: далі textarea скролиться, а не з'їдає стрічку */
const MAX_HEIGHT_PX = 160;

/**
 * Enter надсилає, Shift+Enter переносить рядок.
 *
 * Винесено окремою функцією, щоб правило перевірялось тестом: у раннері немає
 * DOM (`environment: 'node'`, `vitest.config.ts`), а сама умова — це те, що
 * найлегше зламати при редагуванні компонента.
 *
 * `isComposing` — набір через IME (ієрогліфи, діакритика): там Enter підтверджує
 * варіант у редакторі методу вводу, і перехоплювати його не можна.
 */
export function shouldSendOnKey(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

/**
 * Чи слати імпульс «друкую»: лише для непорожнього вводу і не частіше за інтервал
 * (`CHAT_TYPING_PULSE_MS`, менший за термін індикатора, тож безперервний набір не блимає).
 * Чиста функція — правило перевіряється тестом без DOM, як і `shouldSendOnKey`.
 */
export function shouldPulseTyping(
  lastPulseAt: number | null,
  now: number,
  value: string,
): boolean {
  if (value.trim().length === 0) {
    return false;
  }
  return lastPulseAt === null || now - lastPulseAt >= CHAT_TYPING_PULSE_MS;
}

interface ChatComposerProps {
  onSend: (body: string) => void;
  /** Імпульс «друкую»; композер сам тримає інтервал, викликач лише шле подію */
  onTyping?: () => void;
  isDisabled?: boolean;
}

/**
 * Композер. Свій, а не з реєстру: чат-примітиви 2026 року описують діалог з
 * AI-асистентом, і композера месенджера серед них немає (docs/chat.md §4.14.1).
 *
 * Вкладень, емодзі й форматування тут немає свідомо — вони приходять зі своїми
 * фазами, і поки їх немає, панель інструментів була б порожньою рамкою.
 */
export function ChatComposer({ onSend, onTyping, isDisabled = false }: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPulseAt = useRef<number | null>(null);

  // Висота під вміст до стелі. У layout-ефекті, а не в onChange: так вона
  // правильна і після програмного очищення, і після відновлення тексту
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = 'auto';
    node.style.height = `${String(Math.min(node.scrollHeight, MAX_HEIGHT_PX))}px`;
    node.style.overflowY = node.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [value]);

  const canSend = value.trim().length > 0 && !isDisabled;

  const submit = useCallback(() => {
    const body = value.trim();
    if (body.length === 0 || isDisabled) {
      return;
    }
    onSend(body);
    setValue('');
    // Після надсилання імпульс більше не актуальний: наступний набір почне інтервал заново
    lastPulseAt.current = null;
  }, [value, isDisabled, onSend]);

  return (
    // Лінія і фон — на всю ширину, саме поле — у читальній колонці під
    // бульбашками (`chat-layout.ts`)
    <div className="shrink-0 border-t border-border bg-background px-4 py-3">
      <div className={cn('flex items-end gap-2', CHAT_COLUMN)}>
        <Textarea
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={CHAT_MAX_MESSAGE_CHARS}
          disabled={isDisabled}
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.label')}
          className="max-h-40 min-h-9 resize-none"
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            const now = Date.now();
            if (onTyping && shouldPulseTyping(lastPulseAt.current, now, next)) {
              lastPulseAt.current = now;
              onTyping();
            }
          }}
          onKeyDown={(event) => {
            if (
              shouldSendOnKey({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
              })
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          disabled={!canSend}
          aria-label={t('composer.send')}
          onClick={submit}
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}
