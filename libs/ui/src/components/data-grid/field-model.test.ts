import { describe, expect, it } from 'vitest';
import {
  INITIAL_FIELDS_STATE,
  canHideField,
  reduceFieldsState,
  resolveVisibility,
  sanitizeStoredFieldsState,
  serializeFieldsState,
  syncFieldSets,
  validateFieldSets,
} from './field-model';
import type { FieldMeta, FieldsAction } from './field-model';
import { CUSTOM_FIELD_SET_ID } from './types';
import type { DataGridFieldSet, DataGridFieldsState } from './types';

const fields: FieldMeta[] = [
  { id: 'number' },
  { id: 'name', hideable: false },
  { id: 'phone' },
  { id: 'status' },
  { id: 'tags', defaultHidden: true },
];

const sets: DataGridFieldSet[] = [
  { id: 'main', label: 'Main', fields: ['number', 'name', 'phone', 'status'] },
  // Порядок навмисно відмінний від декларації
  { id: 'sales', label: 'Sales', fields: ['tags', 'status'] },
];

function reduce(state: DataGridFieldsState, action: FieldsAction): DataGridFieldsState {
  return reduceFieldsState(state, action, fields);
}

/** Те, що робить FieldSets на маунті/після reset: застосувати потрібний пресет */
function synced(state: DataGridFieldsState): DataGridFieldsState {
  const action = syncFieldSets(state, sets);
  return action ? reduce(state, action) : state;
}

function visibleIds(state: DataGridFieldsState): string[] {
  const visible = resolveVisibility(fields, state);
  // Порядок рендера — як у декларації, тож і тут
  return fields.filter((field) => visible.has(field.id)).map((field) => field.id);
}

const onMain = synced(INITIAL_FIELDS_STATE);
const onSales = reduce(onMain, { type: 'applyPreset', id: 'sales', fields: ['tags', 'status'] });

describe('resolveVisibility', () => {
  it('без наборів полів — дефолти полів (усе, що не defaultHidden)', () => {
    expect(visibleIds(INITIAL_FIELDS_STATE)).toEqual(['number', 'name', 'phone', 'status']);
  });

  it('пресет показує свої поля плюс non-hideable, у порядку декларації', () => {
    expect(visibleIds(onSales)).toEqual(['name', 'status', 'tags']);
  });

  it('поле, відсутнє в мапі Custom, бере свій defaultHidden', () => {
    const state = { ...INITIAL_FIELDS_STATE, activeSetId: CUSTOM_FIELD_SET_ID, custom: {} };
    expect(visibleIds({ ...state, custom: { number: false } })).toEqual([
      'name',
      'phone',
      'status',
    ]);
  });

  it('порожній результат падає на дефолти полів', () => {
    const onlyHideable: FieldMeta[] = [{ id: 'a' }, { id: 'b', defaultHidden: true }];
    const state = {
      activeSetId: CUSTOM_FIELD_SET_ID,
      preset: null,
      custom: { a: false, b: false },
    };
    expect([...resolveVisibility(onlyHideable, state)]).toEqual(['a']);
  });
});

describe('syncFieldSets', () => {
  it('нічого не обрано → застосовує перший набір', () => {
    expect(onMain.activeSetId).toBe('main');
    expect(visibleIds(onMain)).toEqual(['number', 'name', 'phone', 'status']);
  });

  it('збережений id пресета без застосованого складу → застосовує його з коду', () => {
    const restored = synced({ ...INITIAL_FIELDS_STATE, activeSetId: 'sales' });
    expect(visibleIds(restored)).toEqual(['name', 'status', 'tags']);
  });

  it('невідомий збережений id → перший набір', () => {
    expect(synced({ ...INITIAL_FIELDS_STATE, activeSetId: 'gone' }).activeSetId).toBe('main');
  });

  it('змінений у коді склад пресета застосовується заново', () => {
    const stale = { ...onSales, preset: { id: 'sales', fields: ['phone'] } };
    expect(visibleIds(synced(stale))).toEqual(['name', 'status', 'tags']);
  });

  it('застосований пресет і активний Custom не чіпає', () => {
    expect(syncFieldSets(onMain, sets)).toBeNull();
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    expect(syncFieldSets(custom, sets)).toBeNull();
  });
});

describe('reduceFieldsState', () => {
  it('перша правка на пресеті переводить у Custom з уже застосованою правкою', () => {
    const next = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(visibleIds(next)).toEqual(['number', 'name', 'status']);
  });

  it('правка без наборів полів теж веде в Custom', () => {
    const next = reduce(INITIAL_FIELDS_STATE, { type: 'toggle', fieldId: 'tags', visible: true });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(visibleIds(next)).toEqual(['number', 'name', 'phone', 'status', 'tags']);
  });

  it('правка на Custom патчить його, лишаючись на Custom', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const next = reduce(custom, { type: 'toggle', fieldId: 'tags', visible: true });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(visibleIds(next)).toEqual(['number', 'name', 'status', 'tags']);
  });

  it('вибір пресета зберігає Custom, і повернення відновлює його як був', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const switched = reduce(custom, {
      type: 'applyPreset',
      id: 'sales',
      fields: ['tags', 'status'],
    });
    expect(switched.custom).toEqual(custom.custom);
    const back = reduce(switched, { type: 'selectCustom' });
    expect(visibleIds(back)).toEqual(visibleIds(custom));
  });

  it('правка на іншому пресеті перебудовує Custom з нього', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const switched = reduce(custom, {
      type: 'applyPreset',
      id: 'sales',
      fields: ['tags', 'status'],
    });
    const next = reduce(switched, { type: 'toggle', fieldId: 'number', visible: true });
    expect(visibleIds(next)).toEqual(['number', 'name', 'status', 'tags']);
  });

  it('Custom, що збігся з пресетом, лишається Custom', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const same = reduce(custom, { type: 'toggle', fieldId: 'phone', visible: true });
    expect(same.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
  });

  it('reset прибирає Custom, а синхронізація повертає перший набір', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const reset = reduce(custom, { type: 'reset' });
    expect(reset.custom).toBeNull();
    expect(synced(reset).activeSetId).toBe('main');
  });

  it('toggle без зміни видимості нічого не змінює', () => {
    expect(reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: true })).toBe(onMain);
  });

  it('non-hideable і невідомі поля не перемикаються', () => {
    expect(reduce(onMain, { type: 'toggle', fieldId: 'name', visible: false })).toBe(onMain);
    expect(reduce(onMain, { type: 'toggle', fieldId: 'ghost', visible: true })).toBe(onMain);
  });

  it('останнє видиме поле сховати не можна', () => {
    const few: FieldMeta[] = [{ id: 'a' }, { id: 'b', defaultHidden: true }];
    const next = reduceFieldsState(
      INITIAL_FIELDS_STATE,
      { type: 'toggle', fieldId: 'a', visible: false },
      few,
    );
    expect(next).toBe(INITIAL_FIELDS_STATE);
    expect(canHideField(resolveVisibility(few, INITIAL_FIELDS_STATE), 'a')).toBe(false);
  });

  it('вибір Custom, якого ще немає — no-op', () => {
    expect(reduce(onMain, { type: 'selectCustom' })).toBe(onMain);
  });
});

describe('sanitizeStoredFieldsState', () => {
  const roundTrip = (state: DataGridFieldsState): DataGridFieldsState =>
    sanitizeStoredFieldsState(JSON.parse(serializeFieldsState(state)), fields);

  it('переживає round-trip; застосований пресет не зберігається', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    expect(roundTrip(custom)).toEqual({ ...custom, preset: null });
    expect(roundTrip(onSales)).toEqual({ activeSetId: 'sales', preset: null, custom: null });
  });

  it('Custom як активний без самого Custom → нічого не обрано', () => {
    const raw = { v: 2, activeSetId: CUSTOM_FIELD_SET_ID, custom: null };
    expect(sanitizeStoredFieldsState(raw, fields).activeSetId).toBeNull();
  });

  it('відкидає невідомі, non-hideable і не-boolean ключі Custom', () => {
    const raw = {
      v: 2,
      activeSetId: CUSTOM_FIELD_SET_ID,
      custom: { ghost: true, name: false, phone: 'yes', status: false },
    };
    expect(sanitizeStoredFieldsState(raw, fields)).toEqual({
      activeSetId: CUSTOM_FIELD_SET_ID,
      preset: null,
      custom: { status: false },
    });
  });

  it('чужа форма або стара версія → початковий стан', () => {
    for (const raw of [null, 'x', [], { v: 1, activeLayoutId: 'sales', custom: null }]) {
      expect(sanitizeStoredFieldsState(raw, fields)).toEqual(INITIAL_FIELDS_STATE);
    }
  });
});

describe('validateFieldSets', () => {
  it('ловить зарезервований id і невідомі поля набору', () => {
    const problems = validateFieldSets(fields, [
      { id: CUSTOM_FIELD_SET_ID, label: 'X', fields: ['ghost'] },
    ]);
    expect(problems).toHaveLength(2);
  });
});
