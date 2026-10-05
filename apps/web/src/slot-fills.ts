import { fillSlot, type SlotFill } from './lib/slots';
import { shellHeaderActions, shellSidePanels } from './app-shell/slots';
import { dashboardWidgets } from './components/dashboard/slots';
import { customerOverviewCards } from './components/customer-detail-slots';
import { AiHeaderAction, AiSidePanel } from './components/ai/ai-shell-fills';
import { DashboardAgendaWidget } from './components/calendar/dashboard-agenda-widget';
import { CustomerEventsCard } from './components/calendar/customer-events-card';

/**
 * Composition root слотів (docs/modules.md §4–§5): ЄДИНЕ місце, що знає, яка фіча
 * що кладе в модулі нижче. Порядок у масиві — порядок рендеру в слоті.
 * Прибираючи фічу з форку, прибери її рядки тут.
 */
export const SLOT_FILLS: readonly SlotFill[] = [
  // ai
  fillSlot(shellHeaderActions, 'ai', AiHeaderAction),
  fillSlot(shellSidePanels, 'ai', AiSidePanel),
  // calendar
  fillSlot(dashboardWidgets, 'calendar.agenda', DashboardAgendaWidget),
  fillSlot(customerOverviewCards, 'calendar.upcoming-events', CustomerEventsCard),
];
