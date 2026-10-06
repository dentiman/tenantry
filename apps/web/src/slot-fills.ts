import { fillSlot, type SlotFill } from './lib/slots';
import { shellHeaderActions, shellSidePanels } from './app-shell/slots';
import { dashboardWidgets } from './features/dashboard/components/slots';
import {
  customerDetailTabs,
  customerOverviewCards,
} from './features/customers/customer-detail-slots';
import { AiHeaderAction, AiSidePanel } from './features/ai/components/ai-shell-fills';
import { DashboardAgendaWidget } from './features/calendar/components/dashboard-agenda-widget';
import { CustomerEventsCard } from './features/calendar/components/customer-events-card';
import { CustomerEventsTabTrigger } from './features/calendar/components/customer-events-tab';

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
  fillSlot(customerDetailTabs, 'calendar.events', CustomerEventsTabTrigger),
];
