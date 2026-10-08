import { useActiveArea } from '@saas-skeleton/ui/navigation';
import { assistantArea } from '../ai.nav';
import { useAiPanelStore } from '../stores/ai-panel.store';
import { AiPanel } from './ai-panel';
import { AiPanelTrigger } from './ai-panel-trigger';
import { useAiEnabled } from './use-ai-enabled';

/**
 * Внески асистента в оболонку (`app-shell/slots.ts`). Обидва мовчать, поки фіча вимкнена
 * в інсталяції (`features.ai` з bootstrap); прапорець і стан панелі живуть поза роутером,
 * тож панель переживає перехід між area.
 *
 * На сторінці асистента (`/assistant`) обидва теж мовчать: розмова вже в центрі, і
 * панель показала б її вдруге. Стан «відкрита» в сторі при цьому не чіпається —
 * повернувшись в інший розділ, людина знайде панель там, де лишила.
 */
export function AiHeaderAction() {
  const isEnabled = useAiEnabled();
  const isOnPage = useActiveArea()?.id === assistantArea.id;
  return isEnabled && !isOnPage ? <AiPanelTrigger /> : null;
}

/**
 * Асистент — НАЙПРАВІША колонка, сусід `ContextPanelSlot`, а не його дитина: йде від
 * верху вікна до низу і підрізає хедер справа. Може бути відкритий одночасно з
 * контекстною панеллю — вони незалежні
 */
export function AiSidePanel() {
  const isEnabled = useAiEnabled();
  const isOpen = useAiPanelStore((state) => state.isOpen);
  const isOnPage = useActiveArea()?.id === assistantArea.id;
  return isEnabled && isOpen && !isOnPage ? <AiPanel /> : null;
}
