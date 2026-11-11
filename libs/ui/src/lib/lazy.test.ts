import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './lazy';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://x/assets/a.js',
    'error loading dynamically imported module: http://x/assets/a.js',
    'Importing a module script failed.',
  ])('розпізнає провал чанка: %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('не плутає звичайні помилки', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});
