import type { SortDescriptor, SortOrder } from './types';

/** Міст між SortDescriptor (UI) і API-параметрами sortBy/sortOrder */
export function toSortDescriptor(
  sortBy: string | undefined,
  sortOrder: SortOrder | undefined,
): SortDescriptor | undefined {
  if (!sortBy) {
    return undefined;
  }
  return { column: sortBy, direction: sortOrder === 'desc' ? 'descending' : 'ascending' };
}

// sortBy — рядок; викликач звужує до свого enum sortBy (той самий, що в URL search
// schema й у query-параметрах API) у місці виклику, де тип колонки вже відомий
export function fromSortDescriptor(descriptor: SortDescriptor): {
  sortBy: string;
  sortOrder: SortOrder;
} {
  return {
    sortBy: descriptor.column,
    sortOrder: descriptor.direction === 'descending' ? 'desc' : 'asc',
  };
}
