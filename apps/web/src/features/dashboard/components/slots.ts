import { defineSlot } from '../../../lib/slots';

/**
 * Віджети доски. Кожен — самодостатня плитка `DashboardWidget` у сітці на три колонки;
 * дашборд не знає, звідки вони, і доповнює доску плейсхолдерами
 */
export const dashboardWidgets = defineSlot('dashboard.widgets');
