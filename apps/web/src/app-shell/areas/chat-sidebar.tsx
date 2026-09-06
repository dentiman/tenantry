import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';

/**
 * Друга колонка area «Chat» — тут житиме список розмов.
 *
 * Порожня вона не тому, що «ще не дійшли руки», а тому що це перша area, чия
 * друга колонка НЕ є меню: список співрозмовників із пошуком і непрочитаними.
 * Саме через неї контракт `AppArea.Sidebar` — компонент, а не масив пунктів
 * (`areas.tsx`); якби контракт був «пункти меню», чат не влазив би вже тут.
 */
export function ChatSidebar() {
  const { t } = useTranslation('chat');

  return (
    <Empty className="justify-start pt-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquare />
        </EmptyMedia>
        <EmptyTitle>{t('sidebar.empty.title')}</EmptyTitle>
        <EmptyDescription>{t('sidebar.empty.description')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
