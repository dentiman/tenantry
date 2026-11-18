import { describe, expect, it } from 'vitest';
import { exportFiltersFromSearch } from './export-customers-button';

describe('exportFiltersFromSearch', () => {
  it('keeps the grid filters and sort, drops pagination', () => {
    expect(
      exportFiltersFromSearch({
        search: 'Acme',
        status: 'ACTIVE',
        sortBy: 'name',
        sortOrder: 'desc',
        page: 3,
        limit: 50,
      }),
    ).toEqual({ search: 'Acme', status: 'ACTIVE', sortBy: 'name', sortOrder: 'desc' });
  });

  it('turns an empty or invalid search into no filters (only the default sort order)', () => {
    expect(exportFiltersFromSearch(undefined)).toEqual({ sortOrder: 'asc' });
    expect(exportFiltersFromSearch({ status: 'NOPE' })).toEqual({ sortOrder: 'asc' });
  });
});
