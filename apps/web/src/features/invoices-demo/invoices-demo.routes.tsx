import { createRoute } from '@tanstack/react-router';
import { workspaceRoute } from '../../app-shell/app.routes';
import { InvoicesDemoPage } from './pages/invoices';

/**
 * Демо-сторінка інвойсів на фейкових даних (показ клієнтам). Уся фіча — ця тека; поза нею
 * лише рядки підключення з позначкою `invoices-demo` у `router.tsx`, `i18n/namespaces.ts` і
 * `modules.config.ts` — прибрати демо означає видалити теку й ці рядки.
 */
export const invoicesDemoRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'invoices',
  component: InvoicesDemoPage,
  staticData: { layout: 'bleed' },
});
