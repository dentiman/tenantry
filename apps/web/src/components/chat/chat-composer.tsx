import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendHorizontal } from 'lucide-react';
import { CHAT_MAX_MESSAGE_CHARS } from '@saas-skeleton/contracts';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';

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

interface ChatComposerProps {
  onSend: (body: string) => void;
  isDisabled?: boolean;
}

/**
 * Композер. Свій, а не з реєстру: чат-примітиви 2026 року описують діалог з
 * AI-асистентом, і композера месенджера серед них немає (docs/chat.md §4.14.1).
 *
 * Вкладень, емодзі й форматування тут немає свідомо — вони приходять зі своїми
 * фазами, і поки їх немає, панель інструментів була б порожньою рамкою.
 */
export function ChatComposer({ onSend, isDisabled = false }: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  }, [value, isDisabled, onSend]);

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background px-4 py-3">
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
          setValue(event.target.value);
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
  );
}
