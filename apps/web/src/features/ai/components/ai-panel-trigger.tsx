import { useTranslation } from 'react-i18next';
import { SparklesIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { useAiPanelStore } from '../stores/ai-panel.store';

/**
 * Кнопка асистента в хедері. ОКРЕМА від `ContextPanelTrigger`: це дві незалежні
 * панелі, які можуть бути відкриті одночасно, тож і контрол у кожної свій.
 */
export function AiPanelTrigger() {
  const { t } = useTranslation('ai');
  const isOpen = useAiPanelStore((state) => state.isOpen);
  const toggle = useAiPanelStore((state) => state.toggle);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('toggle')}
      aria-pressed={isOpen}
      title={t('toggle')}
      onClick={toggle}
    >
      <SparklesIcon />
    </Button>
  );
}
