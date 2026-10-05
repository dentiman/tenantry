import { z } from 'zod';

// Операторська identity control plane (platform_users, НЕ tenant-юзери). Модуль `auth`
// (modules.config.ts) — окремо від тенантів, щоб вхід оператора не залежав від їхнього CRUD.

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

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
  // AUTH-2: access 15 хв; refresh їде в httpOnly cookie `saas_platform_refresh`
  // (Path=/api/auth) — у тілі його більше немає (було: MVP MT-3, 60m без refresh)
  accessToken: z.string(),
});

/** Відповідь `POST /auth/refresh` — та сама форма, що accessToken у логіні */
export const PlatformAuthTokensSchema = z.object({
  accessToken: z.string(),
});
