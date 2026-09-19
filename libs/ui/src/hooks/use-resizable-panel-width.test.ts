import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampPanelWidth, readStoredPanelWidth } from './use-resizable-panel-width';

describe('clampPanelWidth', () => {
  it('не пускає нижче мінімуму', () => {
    expect(clampPanelWidth(100, 224, 800)).toBe(224);
  });

  it('не пускає вище максимуму', () => {
    expect(clampPanelWidth(900, 224, 800)).toBe(800);
  });

  it('лишає значення в межах як є', () => {
    expect(clampPanelWidth(400, 224, 800)).toBe(400);
  });
});

describe('readStoredPanelWidth', () => {
  function stubLocalStorage(store: Record<string, string>) {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key in store ? store[key] : null),
      },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('читає збережене значення і клемпить його до поточних меж', () => {
    stubLocalStorage({ 'panel:width': '900' });
    expect(readStoredPanelWidth('panel:width', 224, 800, 224)).toBe(800);
  });

  it('падає на дефолт, коли нічого не збережено', () => {
    stubLocalStorage({});
    expect(readStoredPanelWidth('panel:width', 224, 800, 288)).toBe(288);
  });

  it('падає на дефолт, коли збережене значення не число', () => {
    stubLocalStorage({ 'panel:width': 'not-a-number' });
    expect(readStoredPanelWidth('panel:width', 224, 800, 288)).toBe(288);
  });
});
