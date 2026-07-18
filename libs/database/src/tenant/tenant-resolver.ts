import { Inject, Injectable } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';
import { PRISMA_BASE } from './tokens';

/** Мінімум, потрібний резолверу від запиту (не тягнемо типи express у публічний API) */
export interface TenantResolutionRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/**
 * Результат резолюції. authoritative — чи МУСИТЬ tenantId токена збігатися з резолвленим
 * (JwtAuthGuard відхиляє mismatch тільки для авторитетної резолюції):
 *  - Static (N=1): завжди авторитетна — чужий токен на інсталяції недійсний;
 *  - Slug: авторитетна ЛИШЕ коли slug присутній у запиті; на звичайних authenticated-запитах
 *    slug-а немає, fallback НЕ авторитетний — авторитет належить підписаному токену;
 *  - Subdomain (MT-4): завжди авторитетна (Host є на кожному запиті).
 */
export interface TenantResolution {
  tenantId: string | undefined;
  authoritative: boolean;
}

/**
 * Стратегія «звідки взяти tenantId ДО автентифікації» (login/refresh — @Public()).
 * Це недовірена підказка: вона лише звужує пошук, доступ дають креденшели,
 * а JWT.tenantId завжди береться з рядка юзера в БД (див. multi-tenancy-plan.md).
 */
export abstract class TenantResolver {
  abstract resolve(req: TenantResolutionRequest): Promise<TenantResolution>;
}

export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

const fallbackTenantId = (): string => process.env.SAAS_DEFAULT_TENANT_ID ?? DEFAULT_TENANT_ID;

/** Single-tenant (N=1): константа з env, підказки запиту ігноруються */
@Injectable()
export class StaticTenantResolver extends TenantResolver {
  resolve(): Promise<TenantResolution> {
    return Promise.resolve({ tenantId: fallbackTenantId(), authoritative: true });
  }
}

/**
 * MT-3: slug із Login-payload (поле `tenant`) → tenantId через SECURITY DEFINER
 * `resolve_tenant(slug)` — єдиний дозволений шлях читання tenants по slug-у до
 * автентифікації (сама таблиця під RLS). Іде через ГОЛИЙ клієнт (PRISMA_BASE):
 * контексту ще немає, extension тут ні до чого.
 *
 * Порожнє поле → env-fallback, НЕ авторитетний (N=1-логін працює, а authenticated-запити
 * не конфліктують з токенами інших тенантів). Невідомий/suspended slug → undefined →
 * RLS fail-closed → той самий 401, що й невірний пароль (оракула «тенант існує» немає).
 */
@Injectable()
export class SlugTenantResolver extends TenantResolver {
  constructor(@Inject(PRISMA_BASE) private readonly prisma: PrismaService) {
    super();
  }

  async resolve(req: TenantResolutionRequest): Promise<TenantResolution> {
    const slug = this.extractSlug(req.body);
    if (!slug) {
      return { tenantId: fallbackTenantId(), authoritative: false };
    }
    const rows = await this.prisma.$queryRaw<
      { id: string | null }[]
    >`SELECT resolve_tenant(${slug}) AS id`;
    return { tenantId: rows[0]?.id ?? undefined, authoritative: true };
  }

  private extractSlug(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }
    const tenant = (body as { tenant?: unknown }).tenant;
    return typeof tenant === 'string' && tenant.trim() !== ''
      ? tenant.trim().toLowerCase()
      : undefined;
  }
}
