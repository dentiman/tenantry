export type PageItem = number | 'ellipsis-left' | 'ellipsis-right';

/** Вікно сторінок для пагінації: 1 … (p-1, p, p+1) … total */
export function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: PageItem[] = [1];
  if (current > 3) {
    items.push('ellipsis-left');
  }
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    items.push(p);
  }
  if (current < total - 2) {
    items.push('ellipsis-right');
  }
  items.push(total);
  return items;
}
