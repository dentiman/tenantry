import type { ReactElement } from 'react';
import {
  Blocks,
  BookOpenText,
  CalendarDays,
  LayoutGrid,
  MessagesSquare,
  Settings,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { UserResponse } from '@saas-skeleton/contracts';
import { isUnder, type AreaPrefix } from './paths';
import { CalendarSidebar } from '../features/calendar/calendar-sidebar';
import { ChatSidebar } from '../features/chat/chat-sidebar';
import { GuideSidebar } from '../features/guide/guide-sidebar';
import { PlaygroundSidebar } from '../features/playground/playground-sidebar';
import { SettingsSidebar } from '../features/settings/settings-sidebar';
import { UserSettingsSidebar } from '../features/account/user-settings-sidebar';
import { WorkspaceSidebar } from './areas/workspace-sidebar';

export type AreaId =
  | 'workspace'
  | 'calendar'
  | 'chat'
  | 'settings'
  | 'playground'
  | 'guide'
  | 'user-settings';

export interface AppArea {
  id: AreaId;
  /** Префікс URL — він же «домівка» area: пункт рейлу веде саме сюди */
  prefix: AreaPrefix;
  /** Ключ у namespace `layout` */
  labelKey: string;
  icon: LucideIcon;
  /**
   * Area без пункту в рейлі — доступна лише за прямим посиланням (особисті
   * налаштування: вхід із дропдауна аватара).
   */
  hiddenFromRail?: true;
  /**
   * Гейт ВИДИМОСТІ пункту в рейлі, а не доступу: доступ enforce-ить `beforeLoad`
   * роуту area і бекенд (`@Roles(ADMIN)`). Тут — лише щоб юзер не дивився на
   * розділ, у якому однаково нічого не збереже.
   */
  canSee?: (user: UserResponse) => boolean;
  /**
   * Вміст ДРУГОЇ колонки — компонент, а НЕ масив пунктів меню. Друга колонка
   * шела — це контейнер вигляду (як Side Bar у VS Code), а не підменю: у чаті
   * там буде список розмов із пошуком. Area, які справді є меню, беруть
   * спільний `AreaNav`.
   */
  Sidebar: () => ReactElement;
}

const WORKSPACE_AREA: AppArea = {
  id: 'workspace',
  prefix: '/workspace',
  labelKey: 'areas.workspace',
  icon: LayoutGrid,
  Sidebar: WorkspaceSidebar,
};

/**
 * Реєстр area — єдине місце, де видно всю верхню навігацію застосунку.
 * Порядок = порядок пунктів у рейлі.
 */
export const APP_AREAS: readonly AppArea[] = [
  WORKSPACE_AREA,
  {
    // Календар — власна area, а не пункт у Workspace: у нього своя друга
    // колонка (міні-місяць, а не меню) і власний URL-простір із періодами
    id: 'calendar',
    prefix: '/calendar',
    labelKey: 'areas.calendar',
    icon: CalendarDays,
    Sidebar: CalendarSidebar,
  },
  {
    id: 'chat',
    prefix: '/chat',
    labelKey: 'areas.chat',
    icon: MessagesSquare,
    Sidebar: ChatSidebar,
  },
  {
    id: 'settings',
    prefix: '/settings',
    labelKey: 'areas.settings',
    icon: Settings,
    canSee: (user) => user.role === 'ADMIN',
    Sidebar: SettingsSidebar,
  },
  {
    id: 'playground',
    prefix: '/playground',
    labelKey: 'areas.playground',
    icon: Blocks,
    Sidebar: PlaygroundSidebar,
  },
  {
    // Путівник по продукту — одна довга сторінка; друга колонка — її зміст
    // (параграфи зі scroll-spy), а не меню роутів
    id: 'guide',
    prefix: '/guide',
    labelKey: 'areas.guide',
    icon: BookOpenText,
    Sidebar: GuideSidebar,
  },
  {
    id: 'user-settings',
    prefix: '/user-settings',
    labelKey: 'areas.userSettings',
    icon: UserCog,
    hiddenFromRail: true,
    Sidebar: UserSettingsSidebar,
  },
];

/** Area, чия навігація показується, коли шлях не належить жодній (404 поза area) */
export const DEFAULT_AREA = WORKSPACE_AREA;

/**
 * Активна area — ЧИСТА ФУНКЦІЯ від pathname. Дубльованого стану «яка area
 * вибрана» в застосунку немає: URL і є джерелом правди, тому F5, back/forward і
 * зовнішнє посилання дають той самий рейл, що й клік.
 *
 * `undefined` — легальний результат (шлях поза всіма area, напр. 404): рейл тоді
 * не підсвічує нічого, а панель показує `DEFAULT_AREA`, щоб юзеру був вихід.
 */
export function resolveArea(pathname: string): AppArea | undefined {
  return APP_AREAS.find((area) => isUnder(pathname, area.prefix));
}
