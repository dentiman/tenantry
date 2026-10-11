import { fillSlot, type SlotFill } from './lib/slots';
import { shellHeaderActions, shellSidePanels } from './app-shell/slots';
import { dashboardWidgets } from './features/dashboard/components/slots';
import { customerOverviewCards } from './features/customers/customer-detail-slots';
import { AiHeaderAction, AiSidePanel } from './features/ai/components/ai-shell-fills';
import { DashboardAgendaWidget } from './features/calendar/components/dashboard-agenda-widget';
import { CustomerEventsCard } from './features/calendar/components/customer-events-card';
import { DashboardActivityWidget } from './features/activities/components/dashboard-activity-widget';
import { GuideTourWidget } from './features/guide/components/guide-tour-widget';

/**
 * Composition root слотів (docs/modules.md §4–§5): ЄДИНЕ місце, що знає, яка фіча
 * що кладе в модулі нижче. Порядок у масиві — порядок рендеру в слоті.
 * Прибираючи фічу з форку, прибери її рядки тут.
 */
export const SLOT_FILLS: readonly SlotFill[] = [
  // guide (першою: плитка-вхід на всю ширину стоїть над віджетами дошки)
  fillSlot(dashboardWidgets, 'guide.tour', GuideTourWidget),
  // ai
  fillSlot(shellHeaderActions, 'ai', AiHeaderAction),
  fillSlot(shellSidePanels, 'ai', AiSidePanel),
  // calendar
  fillSlot(dashboardWidgets, 'calendar.agenda', DashboardAgendaWidget),
  fillSlot(customerOverviewCards, 'calendar.upcoming-events', CustomerEventsCard),
  // activities (після календаря: агенда лишається першою плиткою дошки)
  fillSlot(dashboardWidgets, 'activities.latest', DashboardActivityWidget),
];
