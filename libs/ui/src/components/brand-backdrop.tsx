/**
 * Брендовий фон на все вікно: розмиті плями кольору бренду і точковий візерунок
 * лише в місцях плям.
 *
 * Рендериться шелом ПЕРШОЮ дитиною `SidebarProvider` і без `z-index`: так він
 * малюється під фіксованим контейнером сайдбара (`z-10`) і під `SidebarInset`
 * (`relative`, пізніше в DOM). Від'ємний `z-index` тут не годиться — фон
 * пішов би під непрозорий `body`.
 *
 * Сам по собі нічого не робить із шелом — поверхні стають склом від атрибута
 * `data-backdrop` на обгортці. Стилі й токени — `brand-backdrop.css`.
 */
export function BrandBackdrop() {
  return (
    <div aria-hidden className="brand-backdrop">
      <div className="brand-backdrop__glow brand-backdrop__glow--1" />
      <div className="brand-backdrop__glow brand-backdrop__glow--2" />
      <div className="brand-backdrop__glow brand-backdrop__glow--3" />
      <div className="brand-backdrop__dots" />
    </div>
  );
}
