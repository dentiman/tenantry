import { CustomerQuerySchema } from '@saas-skeleton/contracts';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { workspaceRoute } from '../../app-shell/app.routes';
import { CustomerContactsTab } from './pages/customer-contacts';
import { CustomerDetailLayout } from './pages/customer-detail';
import { CustomerOverviewTab } from './pages/customer-overview';
import { CustomersPage } from './pages/customers';

// Той самий контракт, що в /users: стан списку живе в URL, невалідні значення
// тихо падають у дефолт замість помилки роута
export const CustomersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Whitelist полів сортування — той самий, що на бекенді (не дублюємо enum)
  sortBy: CustomerQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: CustomerQuerySchema.shape.sortOrder.catch(undefined),
  status: CustomerQuerySchema.shape.status.catch(undefined),
  kind: CustomerQuerySchema.shape.kind.catch(undefined),
});

export type CustomersSearch = z.infer<typeof CustomersSearchSchema>;

export const customersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers',
  validateSearch: (search) => CustomersSearchSchema.parse(search),
  component: CustomersPage,
  staticData: { layout: 'bleed' },
});

/**
 * Картка кастомера: окремий роут — на неї дають посилання в листі й у тікеті. Це ЛЕЙАУТ
 * (шапка + вкладки + `<Outlet/>`): вкладки — дочірні маршрути, і фічі чіпляють сюди свої
 * (`customerEventsRoute` календаря) — дерево складає `router.tsx` (docs/modules.md §7.4)
 */
export const customerDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers/$customerId',
  component: CustomerDetailLayout,
});

export const customerOverviewRoute = createRoute({
  getParentRoute: () => customerDetailRoute,
  path: '/',
  component: CustomerOverviewTab,
});

export const customerContactsRoute = createRoute({
  getParentRoute: () => customerDetailRoute,
  path: 'contacts',
  component: CustomerContactsTab,
});
