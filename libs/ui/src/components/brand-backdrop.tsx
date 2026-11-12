/**
 * Брендовий фон на все вікно: розмиті плями кольору бренду і точковий візерунок
 * лише в місцях плям.
 *
 * Рендериться шелом ПЕРШОЮ дитиною `SidebarProvider` і без `z-index`: так він
 * малюється під фіксованим контейнером сайдбара (`z-10`) і під `SidebarInset`
 * (`relative`, пізніше в DOM). Від'ємний `z-index` тут не годиться — фон
 * пішов би під непрозорий `body`.
 *
 * Варіант `auth` — для сторінок входу (`auth-shell.tsx`), див. §7 brand-backdrop.md.
 * Варіант `guide` — путівник: той самий спокійний фон, але світло зліва, на стику
 * бічної колонки й контенту (§4 у `brand-backdrop.css`).
 *
 * Сам по собі нічого не робить із шелом — поверхні стають склом від атрибута
 * `data-backdrop` на обгортці. Стилі й токени — `brand-backdrop.css`.
 */
export function BrandBackdrop({ variant = 'shell' }: { variant?: 'shell' | 'auth' | 'guide' }) {
  // `auth` — сторінки входу (`AuthShell`): ті самі три плями, але зібрані в одну ауру
  // по центру вікна і БЕЗ точок; геометрію й кольори дає модифікатор `--auth` у CSS
  // `guide` — те саме без точок, але з іншою геометрією ауры (світло ліворуч)
  const isCalm = variant !== 'shell';
  const className =
    variant === 'shell' ? 'brand-backdrop' : `brand-backdrop brand-backdrop--${variant}`;

  return (
    <div aria-hidden className={className}>
      <div className="brand-backdrop__glow brand-backdrop__glow--1" />
      <div className="brand-backdrop__glow brand-backdrop__glow--2" />
      <div className="brand-backdrop__glow brand-backdrop__glow--3" />
      {!isCalm && <div className="brand-backdrop__dots" />}
    </div>
  );
}
