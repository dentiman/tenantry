import { MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «Playground» — візуальні стенди примітивів UI.
 *
 * Пункт поки один (кнопки — рівно те, що стенд показує сьогодні), і саме тому
 * area має сенс: наступний стенд додається рядком тут + роутом, а не грудкою
 * якорів на одній сторінці, як було.
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
      ]}
    />
  );
}
