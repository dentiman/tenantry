import { createRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { JobQuerySchema } from '@saas-skeleton/contracts';
import { appRoute } from '../../app-shell/app.routes';
import { JobsPage } from './pages/jobs';
import { QueuesPage } from './pages/queues';

/**
 * Area «Operations» — машинерія системи (моніторинг черг). Layout-роут без
 * компонента; навігація area — `app-shell/areas/operations-sidebar.tsx`.
 */
export const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/operations',
});

/** `/operations` → Jobs: «домівка» area мусить щось показувати */
export const operationsIndexRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/operations/jobs', replace: true });
  },
});

// Той самий патерн, що був у tenant-web до MT-3: стан списку живе в URL
export const JobsSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  queue: z.string().trim().optional().catch(undefined),
  state: JobQuerySchema.shape.state.catch(undefined),
  sortBy: JobQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: JobQuerySchema.shape.sortOrder.catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці jobs — runtime-форму гарантує validateSearch */
export type JobsSearch = z.infer<typeof JobsSearchSchema>;

export const operationsJobsRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'jobs',
  validateSearch: (search) => JobsSearchSchema.parse(search),
  component: JobsPage,
  staticData: { layout: 'bleed' },
});

/**
 * Черги — окрема сторінка (сітка карток), а не блок над таблицею джоб: тепер
 * `/operations/jobs` — чисте `bleed`-полотно таблиці, як `/users` у tenant-web.
 */
export const operationsQueuesRoute = createRoute({
  getParentRoute: () => operationsRoute,
  path: 'queues',
  component: QueuesPage,
});
