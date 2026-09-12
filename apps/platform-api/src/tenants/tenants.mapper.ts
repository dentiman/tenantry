import type { Tenant } from '@saas-skeleton/database';
import type { TenantListResponse, TenantResponse } from '@saas-skeleton/contracts/platform';

// settings (Json) свідомо НЕ віддається списком — внутрішня кухня tenant-а
export function toTenantResponse(tenant: Tenant): TenantResponse {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    isActive: tenant.isActive,
    locale: tenant.locale,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

export function toTenantListResponse(
  items: Tenant[],
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
