import { UserQuerySchema } from '@saas-skeleton/contracts';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { workspaceRoute } from '../../app-shell/app.routes';
import { UserDetailPage } from './pages/user-detail';
import { UsersPage } from './pages/users';

// Стан списку живе в URL — лінк можна шерити, F5 не губить пошук/сторінку.
// .catch() — невалідні значення з URL тихо падають у дефолт замість помилки роута
export const UsersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  // max — дзеркало бекенда (PaginationQuerySchema): невалідний ліміт з URL падає
  // в дефолт тут, а не 400-кою на API
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Той самий whitelist полів, що й на бекенді (UserQuerySchema.sortBy) — не дублюємо enum
  sortBy: UserQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: UserQuerySchema.shape.sortOrder.catch(undefined),
  // В URL і в query-параметрах API фільтр їде РЯДКОМ 'true'/'false' (не reuse
  // UserQuerySchema.shape.isActive — його transform дає boolean, а це wire-формат)
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці users — runtime-форму гарантує validateSearch */
export type UsersSearch = z.infer<typeof UsersSearchSchema>;

export const usersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users',
  validateSearch: (search) => UsersSearchSchema.parse(search),
  component: UsersPage,
  staticData: { layout: 'bleed' },
});

/** Сторінка юзера: окремий роут, а не драйвер — на неї можна дати посилання */
export const userDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users/$userId',
  component: UserDetailPage,
});
