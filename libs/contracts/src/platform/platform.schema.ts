import { z } from 'zod';

// MT-3: контракти CONTROL PLANE (apps/platform-api). Свідомо ОКРЕМИЙ підпростір:
// імпортуються як '@saas-skeleton/contracts/platform' і НЕ реекспортуються з головного
// index — OpenAPI-конвеєри двох plane-ів незалежні (docs/multi-tenancy-plan.md §1).

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

// ── Platform auth (операторська identity: platform_users, НЕ tenant-юзери) ──

export const PlatformLoginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1),
});

export const PlatformUserResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const PlatformAuthResponseSchema = z.object({
  user: PlatformUserResponseSchema,
  // MVP control plane: тільки access-токен (60m), refresh-механіки поки немає —
  // операторів мало, перелогін прийнятний; розширення — за потреби
  accessToken: z.string(),
});

// ── Tenants CRUD ──

/** slug: DNS-сумісний (під піддомени MT-4), без нормалізації-сюрпризів */
export const TenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Invalid slug format'));

export const TenantResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  locale: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateTenantSchema = z.object({
  slug: TenantSlugSchema,
  name: z.string().trim().min(1).max(120),
  // .optional() після .default(): узгоджено з CreateUserSchema.locale (I18N-3) —
  // на output-типі поле лишається опційним для форм, бекенд усе одно бачить 'en'
  locale: z.string().default('en').optional(),
  // Перший admin тенанта: початковий пароль задає оператор (рішення 2026-07-16,
  // invite-флоу відкладено на MT-4) — уніфіковано з tenant-рівневим create user
  admin: z.object({
    email: normalizedEmail,
    password: z.string().min(8).max(128),
    name: z.string().nullable().optional(),
  }),
});

export const UpdateTenantSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  locale: z.string().optional(),
  /** suspend/resume: login у data plane відмовляє всім юзерам неактивного tenant-а */
  isActive: z.boolean().optional(),
});

export const TenantListResponseSchema = z.object({
  items: z.array(TenantResponseSchema),
  total: z.number().int(),
});
