import { createRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { AiCostStatusSchema, AiUsageKindSchema } from '@saas-skeleton/contracts/platform';
import { appRoute } from '../../app-shell/app.routes';
import { AiSettingsPage } from './pages/ai-settings';
import { AiCostsPage } from './pages/ai-costs';
import { AiPricesPage } from './pages/ai-prices';

/** Area «AI» — налаштування асистента платформи (AI-5a). Layout-роут без компонента */
export const aiRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ai',
});

export const aiIndexRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/ai/settings', replace: true });
  },
});

export const aiSettingsRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'settings',
  component: AiSettingsPage,
});

/** AI-5b: період і розріз звіту витрат живуть в URL — посиланням можна поділитись */
export const AI_COST_PERIODS = ['this-month', 'last-month', 'last-30-days', 'last-7-days'] as const;
export const AI_COST_DIMENSIONS = ['tenant', 'model', 'kind', 'day'] as const;
/** Зведення чи перелік окремих рядків журналу (events) для того самого періоду */
export const AI_COST_VIEWS = ['overview', 'events'] as const;
export const AiCostsSearchSchema = z.object({
  period: z.enum(AI_COST_PERIODS).optional().catch(undefined),
  by: z.enum(AI_COST_DIMENSIONS).optional().catch(undefined),
  view: z.enum(AI_COST_VIEWS).optional().catch(undefined),
  // DataGrid events: TFilters сумісний — DataGridFiltersBase вимагає лише ці поля опційними
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  search: z.string().trim().max(200).optional().catch(undefined),
  kind: AiUsageKindSchema.optional().catch(undefined),
  costStatus: AiCostStatusSchema.optional().catch(undefined),
});
export type AiCostsSearch = z.infer<typeof AiCostsSearchSchema>;

export const aiCostsRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'costs',
  validateSearch: (search) => AiCostsSearchSchema.parse(search),
  component: AiCostsPage,
});

export const AiPricesSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  search: z.string().trim().max(200).optional().catch(undefined),
});
/** TFilters для DataGrid тарифів — runtime-форму гарантує validateSearch */
export type AiPricesSearch = z.infer<typeof AiPricesSearchSchema>;

export const aiPricesRoute = createRoute({
  getParentRoute: () => aiRoute,
  path: 'prices',
  validateSearch: (search) => AiPricesSearchSchema.parse(search),
  component: AiPricesPage,
  staticData: { layout: 'bleed' },
});
