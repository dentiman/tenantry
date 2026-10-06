import '../load-root-env';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
// Сід — composition root демо-даних модулів: чат провізіонить себе сам (docs/modules.md §7.3).
// Шлях до файлу, а не barrel `@saas-skeleton/shared`: той тягне Nest і pg-boss, сіду не потрібні
import { ensureDefaultChannel, joinDefaultChannel } from '../../shared/src/chat/default-channel';

// MT-2: сід — ОПЕРАТОРСЬКА дія (створення tenant-а) → роль saas_platform (BYPASSRLS).
// Під saas_app упав би на політиках: upsert tenant-а поза власним контекстом заборонений.
const DEFAULT_PLATFORM_DATABASE_URL =
  'postgresql://saas_platform:saas_platform@localhost:5432/saas_skeleton';

// MT-1: well-known id дефолтного tenant-а (той самий, що в міграції і StaticTenantResolver).
// Сід — інфраструктура: явний tenantId тут легальний
const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

const ADMIN_EMAIL = 'admin@example.com';
// AUTH-0: мінімум 12 символів (PasswordSchema). Upsert із `update: {}` пароль наявного
// адміна НЕ переписує — на старій dev-БД лишається попередній до `pnpm db:reset`
const ADMIN_PASSWORD = 'Admin1234567';
const PLATFORM_ADMIN_EMAIL = 'platform@example.com';
const PLATFORM_ADMIN_PASSWORD = 'Platform12345';

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: process.env.PLATFORM_DATABASE_URL ?? DEFAULT_PLATFORM_DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      slug: 'default',
      name: 'Default Tenant',
    },
  });

  const passwordHash = await argon2.hash(ADMIN_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
    },
  });

  // MT-3: оператор control plane (окрема identity, вхід у platform-api)
  const platformAdmin = await prisma.platformUser.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: {},
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      name: 'Platform Operator',
      passwordHash: await argon2.hash(PLATFORM_ADMIN_PASSWORD),
    },
  });

  // Демо-кастомери: щоб грід і картка не відкривались порожніми у свіжому форку.
  // Ідемпотентно по externalId — тому ж ключу, яким користується справжній імпорт.
  // Номери (цілі, свої в кожного тенанта) задаються явно — сервісного шару тут
  // немає, — а лічильник виставляється на максимум використаного: рівно те, що
  // робить будь-який імпорт старої бази, інакше перший створений через UI
  // кастомер отримав би номер 1 і впав на унікальному індексі
  const demoCustomers = [
    {
      externalId: 'seed-1',
      number: 1,
      name: 'Northwind Traders',
      legalName: 'Northwind Traders LLC',
      email: 'billing@northwind.example',
      city: 'Kyiv',
      country: 'UA',
      tags: ['vip'],
    },
    {
      externalId: 'seed-2',
      number: 2,
      name: 'Globex Corporation',
      email: 'ap@globex.example',
      city: 'Warsaw',
      country: 'PL',
      tags: [],
    },
    {
      externalId: 'seed-3',
      number: 3,
      name: 'Jane Doe',
      kind: 'PERSON' as const,
      email: 'jane@example.com',
      tags: [],
    },
  ];

  for (const demo of demoCustomers) {
    await prisma.customer.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: demo.externalId } },
      update: {},
      create: { tenantId: tenant.id, ownerId: admin.id, ...demo },
    });
  }

  await prisma.numberSequence.upsert({
    // scope '' — майстер-дані нумеруються наскрізно, без скидання за періодом
    where: { tenantId_name_scope: { tenantId: tenant.id, name: 'customer', scope: '' } },
    update: {},
    create: { tenantId: tenant.id, name: 'customer', scope: '', lastValue: demoCustomers.length },
  });

  // Дефолтний канал чату — ДВА незалежно ідемпотентні кроки, а не один.
  // Причина конкретна: на свіжій БД канал для цього тенанта створює backfill у
  // міграції (тенант там уже є, юзерів ще немає), і «створити канал разом із
  // членством» просто не спрацювало б — канал уже є, а адмін щойно зʼявився і
  // лишився б поза ним. Тому окремо канал, окремо членство. Обидва кроки — той самий
  // провізіонер, що в control plane і api (docs/modules.md §7.3); tenantId
  // скрізь явний: сід іде під saas_platform (BYPASSRLS)
  await prisma.$transaction((tx) => ensureDefaultChannel(tx, tenant.id));
  await prisma.$transaction((tx) => joinDefaultChannel(tx, tenant.id, admin));

  console.log(
    `Seeded tenant "${tenant.slug}" and admin user: ${admin.email} (password: ${ADMIN_PASSWORD})`,
  );
  console.log(`Seeded ${String(demoCustomers.length)} demo customers`);
  console.log('Seeded the default chat channel "General"');
  console.log(
    `Seeded platform operator: ${platformAdmin.email} (password: ${PLATFORM_ADMIN_PASSWORD})`,
  );
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
