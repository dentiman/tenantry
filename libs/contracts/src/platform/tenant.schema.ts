import { z } from 'zod';
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';
import { PasswordSchema } from '../user/user.schema';

// MT-3: контракти CONTROL PLANE (apps/platform-api) — тенанти; вхід оператора —
// platform-auth.schema.ts. Свідомо ОКРЕМИЙ підпростір: імпортуються як '@saas-skeleton/contracts/platform' і НЕ реекспортуються з головного
// index — OpenAPI-конвеєри двох plane-ів незалежні (docs/multi-tenancy-plan.md §1).

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

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
  /** Дозвіл платформи на AI-асистента (AI-5a); немає запису — дозволено */
  aiAllowed: z.boolean(),
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
    // AUTH-0: та сама політика, що в tenant-плані — це пароль tenant-користувача
    password: PasswordSchema,
    name: z.string().nullable().optional(),
  }),
});

export const UpdateTenantSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  locale: z.string().optional(),
  /** suspend/resume: login у data plane відмовляє всім юзерам неактивного tenant-а */
  isActive: z.boolean().optional(),
  /** Дозвіл AI-асистента цьому tenant-у (AI-5a). Tenant Admin вмикає лише в межах дозволу */
  aiAllowed: z.boolean().optional(),
});

/** Той самий whitelist-патерн, що UserQuerySchema: sortBy — закритий enum у Swagger */
export const TenantQuerySchema = listQuerySchema(['slug', 'name', 'isActive', 'createdAt']).extend({
  // Рядок 'true'/'false' на дроті + transform у boolean — дзеркало UserQuerySchema.isActive
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

export const TenantListResponseSchema = paginatedResponseSchema(TenantResponseSchema);
