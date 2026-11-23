/**
 * Правила нарізки чанків для Vite-збірки обох фронтендів (docs/frontend/lazy-loading.md §4).
 * Чисті функції без залежностей: `vite.config.ts` застосунку імпортує цей файл ВІДНОСНИМ шляхом
 * (конфіг збирається esbuild-ом, а workspace-пакети він лишає зовнішніми, і `.ts` з них не
 * завантажити) — тому цей файл не входить у `exports` пакета.
 *
 * Дві незалежні речі:
 * 1. `manualChunks` — лише СТАБІЛЬНІ вендор-групи, які в будь-якому разі потрібні старту
 *    (react, роутер/запити, i18n, мережа, форми). Мета — кеш: код застосунку змінюється щодеплою,
 *    а ці файли — тільки при оновленні залежностей. Сторінки й важкі бібліотеки (markdown,
 *    календар-пікер) сюди НЕ додаємо: ручна група вантажиться разом з кожним, хто її імпортує,
 *    і затягла б їх у стартовий набір.
 * 2. `chunkFileNames` — читабельні імена: чанк сторінки `features/<модуль>/pages/<сторінка>.tsx`
 *    стає `route-<модуль>-<сторінка>-<хеш>.js`, решта — за іменем, яке дає Rollup.
 */

/** Група → імена npm-пакетів (точний збіг імені, без підпакетів інших пакетів) */
const VENDOR_GROUPS: readonly (readonly [group: string, packages: readonly string[]])[] = [
  ['vendor-react', ['react', 'react-dom', 'scheduler']],
  [
    'vendor-tanstack',
    [
      '@tanstack/react-router',
      '@tanstack/router-core',
      '@tanstack/history',
      '@tanstack/store',
      '@tanstack/react-store',
      '@tanstack/react-query',
      '@tanstack/query-core',
    ],
  ],
  ['vendor-i18n', ['i18next', 'react-i18next']],
  [
    'vendor-net',
    [
      'axios',
      'socket.io-client',
      'socket.io-parser',
      'engine.io-client',
      'engine.io-parser',
      '@socket.io/component-emitter',
    ],
  ],
  ['vendor-forms', ['zod', 'react-hook-form', '@hookform/resolvers']],
];

const PACKAGE_TO_GROUP = new Map(
  VENDOR_GROUPS.flatMap(([group, packages]) => packages.map((name) => [name, group] as const)),
);

/** Ім'я npm-пакета з шляху модуля (враховує вкладений `.pnpm/…/node_modules/<пакет>`) */
export function packageNameOf(id: string): string | undefined {
  const marker = 'node_modules/';
  const index = id.lastIndexOf(marker);
  if (index === -1) return undefined;
  const parts = id.slice(index + marker.length).split('/');
  const first = parts[0];
  if (first === undefined) return undefined;
  return first.startsWith('@') && parts[1] !== undefined ? `${first}/${parts[1]}` : first;
}

export function manualChunks(id: string): string | undefined {
  const name = packageNameOf(id);
  return name === undefined ? undefined : PACKAGE_TO_GROUP.get(name);
}

/** `.../features/chat/pages/chat-conversation.tsx` → `route-chat-chat-conversation` */
const ROUTE_PAGE = /\/features\/([^/]+)\/pages\/([^/]+?)\.[tj]sx?$/;

export function chunkFileNames(chunk: { name: string; facadeModuleId: string | null }): string {
  const match = chunk.facadeModuleId ? ROUTE_PAGE.exec(chunk.facadeModuleId) : null;
  const [, module, page] = match ?? [];
  return module !== undefined && page !== undefined
    ? `assets/route-${module}-${page}-[hash].js`
    : 'assets/[name]-[hash].js';
}
