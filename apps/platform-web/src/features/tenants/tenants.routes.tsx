import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { TenantQuerySchema } from '@saas-skeleton/contracts/platform';
import { appRoute } from '../../app-shell/app.routes';
import { TenantsPage } from './pages/tenants';
import { TenantDetailPage } from './pages/tenant-detail';

/**
 * Area «Tenants» — клієнти платформи. Layout-роут без компонента: навігація
 * area живе в шелі (`app-shell/areas/tenants-sidebar.tsx`).
 */
export const tenantsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tenants',
});

// Стан списку живе в URL — той самий контракт, що в /users у tenant-web
// (.catch() — невалідні значення з URL тихо падають у дефолт, не в помилку роута)
export const TenantsSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Той самий whitelist полів сортування, що на бекенді (не дублюємо enum)
  sortBy: TenantQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: TenantQuerySchema.shape.sortOrder.catch(undefined),
  // В URL і в query-параметрах API фільтр їде РЯДКОМ 'true'/'false' (не reuse
  // TenantQuerySchema.shape.isActive — його transform дає boolean, а це wire-формат)
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці tenants — runtime-форму гарантує validateSearch */
export type TenantsSearch = z.infer<typeof TenantsSearchSchema>;

export const tenantsIndexRoute = createRoute({
  getParentRoute: () => tenantsRoute,
  path: '/',
  validateSearch: (search) => TenantsSearchSchema.parse(search),
  component: TenantsPage,
  staticData: { layout: 'bleed' },
});

/** Картка тенанта: окремий роут — на неї дають посилання (route-id не змінився) */
export const tenantDetailRoute = createRoute({
  getParentRoute: () => tenantsRoute,
  path: '$tenantId',
  component: TenantDetailPage,
});
