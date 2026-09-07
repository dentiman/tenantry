import { MousePointerClick, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «Playground» — візуальні стенди примітивів UI.
 *
 * Стенд додається рядком тут + роутом, а не грудкою якорів на одній сторінці,
 * як було до area.
 */
export function PlaygroundSidebar() {
  const { t } = useTranslation('playground');

  return (
    <AreaNav
      items={[
        {
          to: '/playground',
          label: t('nav.buttons'),
          icon: <MousePointerClick />,
          match: 'exact',
        },
        {
          to: '/playground/multi-user-select',
          label: t('nav.userSelect'),
          icon: <UsersRound />,
          match: 'exact',
        },
      ]}
    />
  );
}
