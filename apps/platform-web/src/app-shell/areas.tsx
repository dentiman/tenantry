import type { ReactElement } from 'react';
import { Activity, Bot, Building2, UserCog, type LucideIcon } from 'lucide-react';
import { isUnder, type AreaPrefix } from './paths';
import { OperationsSidebar } from '../features/messaging/operations-sidebar';
import { AiSidebar } from '../features/ai/ai-sidebar';
import { TenantsSidebar } from '../features/tenants/tenants-sidebar';
import { UserSettingsSidebar } from '../features/account/user-settings-sidebar';

export type AreaId = 'tenants' | 'operations' | 'ai' | 'user-settings';

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
   * Вміст ДРУГОЇ колонки — компонент, а НЕ масив пунктів меню (дзеркало
   * `apps/web`). Колонка `Tenants` має рівно один пункт — це легально: контракт
   * area не вимагає підменю, компонент лише сьогодні порожній попереду MT-4.
   */
  Sidebar: () => ReactElement;
}

const TENANTS_AREA: AppArea = {
  id: 'tenants',
  prefix: '/tenants',
  labelKey: 'areas.tenants',
  icon: Building2,
  Sidebar: TenantsSidebar,
};

/**
 * Реєстр area — єдине місце, де видно всю верхню навігацію консолі.
 * Порядок = порядок пунктів у рейлі.
 */
export const APP_AREAS: readonly AppArea[] = [
  TENANTS_AREA,
  {
    id: 'operations',
    prefix: '/operations',
    labelKey: 'areas.operations',
    icon: Activity,
    Sidebar: OperationsSidebar,
  },
  {
    id: 'ai',
    prefix: '/ai',
    labelKey: 'areas.ai',
    icon: Bot,
    Sidebar: AiSidebar,
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
export const DEFAULT_AREA = TENANTS_AREA;

/**
 * Активна area — ЧИСТА ФУНКЦІЯ від pathname. Дубльованого стану «яка area
 * вибрана» в застосунку немає — дзеркало `apps/web/src/app-shell/areas.tsx`.
 */
export function resolveArea(pathname: string): AppArea | undefined {
  return APP_AREAS.find((area) => isUnder(pathname, area.prefix));
}
