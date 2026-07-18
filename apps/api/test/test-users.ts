import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { DEFAULT_TENANT_ID } from '@saas-skeleton/database';
import type { SystemPrismaService, Role, User } from '@saas-skeleton/database';

export { DEFAULT_TENANT_ID };

export interface TestUserInput {
  email: string;
  password?: string;
  name?: string | null;
  role?: Role;
  isActive?: boolean;
}

/**
 * MT-1: POST /auth/register видалено — юзери для тестів створюються напряму.
 * MT-2: через SystemPrismaService (BYPASSRLS) — тест-скрипт семантично оператор
 * поза tenant-ом; під saas_app прямий INSERT без CLS-контексту падав би на
 * WITH CHECK політики. Явний tenantId тут легальний (інфраструктура).
 */
export async function createTestUser(
  prisma: SystemPrismaService,
  input: TestUserInput,
): Promise<User> {
  const passwordHash = input.password ? await argon2.hash(input.password) : null;
  return prisma.user.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      email: input.email,
      name: input.name ?? null,
      passwordHash,
      role: input.role ?? 'USER',
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export interface TestTokens {
  accessToken: string;
  refreshToken: string;
}

export async function loginTestUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<TestTokens> {
  const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return (response.body as { tokens: TestTokens }).tokens;
}

/** Створити юзера і одразу залогінити — заміна колишнього register-бутстрапа */
export async function createAndLoginTestUser(
  app: INestApplication,
  prisma: SystemPrismaService,
  input: TestUserInput & { password: string },
): Promise<{ user: User; tokens: TestTokens }> {
  const user = await createTestUser(prisma, input);
  const tokens = await loginTestUser(app, input.email, input.password);
  return { user, tokens };
}
