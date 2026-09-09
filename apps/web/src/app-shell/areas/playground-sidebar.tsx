import {
  AlignLeftIcon,
  MousePointerClick,
  NetworkIcon,
  PanelTopIcon,
  RectangleHorizontalIcon,
  UsersRound,
} from 'lucide-react';
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
          to: '/playground/vertical-form',
          label: t('nav.verticalForm'),
          icon: <AlignLeftIcon />,
          match: 'exact',
        },
        {
          to: '/playground/inline-form',
          label: t('nav.inlineForm'),
          icon: <RectangleHorizontalIcon />,
          match: 'exact',
        },
        {
          to: '/playground/multi-user-select',
          label: t('nav.userSelect'),
          icon: <UsersRound />,
          match: 'exact',
        },
        {
          to: '/playground/dialog',
          label: t('nav.dialog'),
          icon: <PanelTopIcon />,
          match: 'exact',
        },
        {
          to: '/playground/architecture',
          label: t('nav.architecture'),
          icon: <NetworkIcon />,
          match: 'exact',
        },
      ]}
    />
  );
}
