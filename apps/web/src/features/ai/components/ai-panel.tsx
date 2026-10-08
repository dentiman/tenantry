import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Maximize2Icon, SparklesIcon, XIcon } from 'lucide-react';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { ResizeHandle } from '@saas-skeleton/ui/components/resize-handle';
import { useAiConversation } from '../../../api/generated/api';
import { useAiPanelStore } from '../stores/ai-panel.store';
import { AiConversationView } from './ai-conversation-view';
import { AiDeleteAllButton, AiNewConversationButton } from './ai-conversation-actions';

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
 *
 * Сама розмова — `AiConversationView`, той самий, що на сторінці `/assistant`; тут
 * лише оболонка колонки. Панель завжди показує ПОТОЧНУ розмову — історія живе на сторінці.
 */
export function AiPanel() {
  const { t } = useTranslation('ai');
  const close = useAiPanelStore((state) => state.close);
  const { data: conversation } = useAiConversation();
  const messages = conversation?.messages ?? [];

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
        <SparklesIcon className="size-4 text-icon" aria-hidden />
        <span className="flex-1 truncate text-sm font-medium">{t('title')}</span>
        {/* На сторінці асистента панель ховається сама (`AiSidePanel`), а стан
            «відкрита» лишається — повернувшись, людина знайде її там, де лишила */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('openPage')}
          title={t('openPage')}
          nativeButton={false}
          render={<Link to="/assistant" />}
        >
          <Maximize2Icon />
        </Button>
        <AiNewConversationButton disabled={messages.length === 0} />
        <AiDeleteAllButton />
        <Button type="button" variant="ghost" size="icon" aria-label={t('close')} onClick={close}>
          <XIcon />
        </Button>
      </header>

      <AiConversationView messages={messages} variant="panel" />
    </aside>
  );
}
