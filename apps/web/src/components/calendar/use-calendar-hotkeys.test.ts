import { describe, expect, it } from 'vitest';
import { resolveHotkey } from './use-calendar-hotkeys';

/** Натискання без модифікаторів; кожен тест перебиває лише те, що йому треба */
const press = (key: string, modifiers: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('resolveHotkey', () => {
  it('T — сьогодні, у будь-якому регістрі', () => {
    expect(resolveHotkey(press('t'))).toEqual({ kind: 'today' });
    expect(resolveHotkey(press('T', { shiftKey: true }))).toEqual({ kind: 'today' });
  });

  it('перша літера перегляду перемикає перегляд', () => {
    expect(resolveHotkey(press('d'))).toEqual({ kind: 'view', view: 'day' });
    expect(resolveHotkey(press('w'))).toEqual({ kind: 'view', view: 'week' });
    expect(resolveHotkey(press('m'))).toEqual({ kind: 'view', view: 'month' });
    expect(resolveHotkey(press('a'))).toEqual({ kind: 'view', view: 'agenda' });
  });

  it('N і C однаково створюють подію (звичка з Google)', () => {
    expect(resolveHotkey(press('n'))).toEqual({ kind: 'create' });
    expect(resolveHotkey(press('c'))).toEqual({ kind: 'create' });
  });

  it('стрілки листають період', () => {
    expect(resolveHotkey(press('ArrowLeft'))).toEqual({ kind: 'shift', direction: -1 });
    expect(resolveHotkey(press('ArrowRight'))).toEqual({ kind: 'shift', direction: 1 });
  });

  it('? відкриває довідку — і готовим символом, і як Shift+/', () => {
    expect(resolveHotkey(press('?', { shiftKey: true }))).toEqual({ kind: 'help' });
    // У частині розкладок `key` лишається `/` навіть із затиснутим Shift
    expect(resolveHotkey(press('/', { shiftKey: true }))).toEqual({ kind: 'help' });
  });

  it('/ без Shift довідку НЕ відкриває', () => {
    expect(resolveHotkey(press('/'))).toBeNull();
  });

  /** `Cmd+D` — закладка браузера, `Alt+←` — його «назад»: календар їх не забирає */
  it('будь-який модифікатор знімає обробку', () => {
    expect(resolveHotkey(press('d', { metaKey: true }))).toBeNull();
    expect(resolveHotkey(press('d', { ctrlKey: true }))).toBeNull();
    expect(resolveHotkey(press('ArrowLeft', { altKey: true }))).toBeNull();
  });

  it('невідома клавіша не робить нічого', () => {
    expect(resolveHotkey(press('x'))).toBeNull();
    expect(resolveHotkey(press('Enter'))).toBeNull();
    expect(resolveHotkey(press(' '))).toBeNull();
  });
});
