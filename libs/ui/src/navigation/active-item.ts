import { isUnder } from './registry';

/** Найдовший збіг виграє; індексна вкладка не активна на дочірніх сторінках. */
export function activeItemId(
  items: readonly { id: string; pathname: string; match?: 'exact' | 'prefix' }[],
  pathname: string,
): string | undefined {
  const normalize = (path: string) => path.replace(/\/$/, '') || '/';
  const current = normalize(pathname);
  return items
    .map((item) => ({ ...item, pathname: normalize(item.pathname) }))
    .filter((item) =>
      item.match === 'exact' ? current === item.pathname : isUnder(current, item.pathname),
    )
    .sort((a, b) => b.pathname.length - a.pathname.length)[0]?.id;
}
