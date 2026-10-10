/**
 * Демо-акаунти (docs/demo.md): ЄДИНЕ джерело для двох споживачів — сіда демо-даних
 * (`libs/database/prisma/seed-demo`, створює саме цих юзерів) і сторінок логіну обох
 * фронтів (чипи «Demo accounts» + префіл форми). Дрейфу між «що показав логін» і «що
 * є в БД» бути не може, бо обидва читають цей файл.
 *
 * Креди СТАТИЧНІ й публічні свідомо (рішення власника 2026-10-10): це демо-стенд, не
 * прод. Посилення безпеки — окремим кроком пізніше; щоб прибрати показ у UI без правки
 * коду, логін-сторінки читають `VITE_DEMO_LOGINS=false`.
 *
 * Порядок має значення: перший акаунт префілиться у форму логіну — це флагманський
 * демо-тенант. Файл без залежностей (ні zod, ні Nest), бо його імпортують і Vite, і tsx.
 */

export interface DemoAccount {
  /** Slug тенанта — те, що йде в поле Organization форми логіну */
  tenant: string;
  tenantName: string;
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'USER';
  /** Підпис ролі в чипі, англійською: людям на демо важливіше «Dispatcher», ніж «USER» */
  roleLabel: string;
}

/** Один пароль на всі демо-акаунти галузевих тенантів; ≥12 символів (PasswordSchema) */
export const DEMO_PASSWORD = 'Demo12345678';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    tenant: 'northwind',
    tenantName: 'Northwind Logistics',
    email: 'olivia.bennett@northwind.example',
    password: DEMO_PASSWORD,
    name: 'Olivia Bennett',
    role: 'ADMIN',
    roleLabel: 'Admin',
  },
  {
    tenant: 'northwind',
    tenantName: 'Northwind Logistics',
    email: 'marcus.reyes@northwind.example',
    password: DEMO_PASSWORD,
    name: 'Marcus Reyes',
    role: 'USER',
    roleLabel: 'Dispatcher',
  },
  {
    tenant: 'helix',
    tenantName: 'Helix Health',
    email: 'amelia.okafor@helix.example',
    password: DEMO_PASSWORD,
    name: 'Amelia Okafor',
    role: 'ADMIN',
    roleLabel: 'Admin',
  },
  {
    tenant: 'helix',
    tenantName: 'Helix Health',
    email: 'daniel.park@helix.example',
    password: DEMO_PASSWORD,
    name: 'Daniel Park',
    role: 'USER',
    roleLabel: 'Care coordinator',
  },
  {
    tenant: 'brightside',
    tenantName: 'Brightside Studio',
    email: 'sofia.lindqvist@brightside.example',
    password: DEMO_PASSWORD,
    name: 'Sofia Lindqvist',
    role: 'ADMIN',
    roleLabel: 'Admin',
  },
  {
    tenant: 'brightside',
    tenantName: 'Brightside Studio',
    email: 'tom.hartley@brightside.example',
    password: DEMO_PASSWORD,
    name: 'Tom Hartley',
    role: 'USER',
    roleLabel: 'Account manager',
  },
  // Дефолтний тенант із базового `db:seed` (libs/database/prisma/seed.ts) — лишається
  // робочим акаунтом розробника; пароль той самий, що там
  {
    tenant: 'default',
    tenantName: 'Default Tenant',
    email: 'admin@example.com',
    password: 'Admin1234567',
    name: 'Admin',
    role: 'ADMIN',
    roleLabel: 'Admin',
  },
];

/** Оператор control plane (platform-web); той самий, що в базовому сіді */
export const DEMO_PLATFORM_ACCOUNT = {
  email: 'platform@example.com',
  password: 'Platform12345',
  name: 'Platform Operator',
} as const;
