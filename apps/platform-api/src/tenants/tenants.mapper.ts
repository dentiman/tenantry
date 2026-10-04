import type { Tenant, TenantAiAccess } from '@saas-skeleton/database';
import type { TenantListResponse, TenantResponse } from '@saas-skeleton/contracts/platform';

// settings (Json) свідомо НЕ віддається списком — внутрішня кухня tenant-а
export type TenantWithAiAccess = Tenant & { aiAccess: Pick<TenantAiAccess, 'allowed'> | null };

export function toTenantResponse(tenant: TenantWithAiAccess): TenantResponse {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    isActive: tenant.isActive,
    locale: tenant.locale,
    // Немає запису — дозволено (AI-5a, docs/ai-platform-controls.md §2.5)
    aiAllowed: tenant.aiAccess?.allowed ?? true,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

export function toTenantListResponse(
  items: TenantWithAiAccess[],
  total: number,
  page: number,
  limit: number,
): TenantListResponse {
  return {
    items: items.map(toTenantResponse),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
