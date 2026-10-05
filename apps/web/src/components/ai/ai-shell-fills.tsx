import { useAiPanelStore } from '../../stores/ai-panel.store';
import { AiPanel } from './ai-panel';
import { AiPanelTrigger } from './ai-panel-trigger';
import { useAiEnabled } from './use-ai-enabled';

/**
 * Внески асистента в оболонку (`app-shell/slots.ts`). Обидва мовчать, поки фіча вимкнена
 * в інсталяції (`features.ai` з bootstrap); прапорець і стан панелі живуть поза роутером,
 * тож панель переживає перехід між area
 */
export function AiHeaderAction() {
  return useAiEnabled() ? <AiPanelTrigger /> : null;
}

/**
 * Асистент — НАЙПРАВІША колонка, сусід `ContextPanelSlot`, а не його дитина: йде від
 * верху вікна до низу і підрізає хедер справа. Може бути відкритий одночасно з
 * контекстною панеллю — вони незалежні
 */
export function AiSidePanel() {
  const isEnabled = useAiEnabled();
  const isOpen = useAiPanelStore((state) => state.isOpen);
  return isEnabled && isOpen ? <AiPanel /> : null;
}
