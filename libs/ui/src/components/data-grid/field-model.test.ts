import { describe, expect, it } from 'vitest';
import {
  INITIAL_FIELDS_STATE,
  canHideField,
  filterFieldsByQuery,
  mergeOrder,
  reduceFieldsState,
  resolveFields,
  resolveVisibility,
  sanitizeStoredFieldsState,
  serializeFieldsState,
  shouldShowFieldSearch,
  stepMoveTarget,
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
  // Порядок навмисно відмінний від декларації — тепер він і є порядок показу
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

/** Видимі поля в порядку показу — рівно те, що рендерить таблиця */
function shown(state: DataGridFieldsState, meta: FieldMeta[] = fields): string[] {
  return resolveFields(meta, state);
}

const onMain = synced(INITIAL_FIELDS_STATE);
const onSales = reduce(onMain, { type: 'applyPreset', id: 'sales', fields: ['tags', 'status'] });
const move = (fieldId: string, beforeId: string | null): FieldsAction => ({
  type: 'move',
  fieldId,
  beforeId,
});

describe('resolveFields', () => {
  it('без наборів полів — дефолти полів у порядку декларації', () => {
    expect(shown(INITIAL_FIELDS_STATE)).toEqual(['number', 'name', 'phone', 'status']);
  });

  it('пресет показує свої поля в СВОЄМУ порядку; не перелічене non-hideable — за декларацією', () => {
    expect(shown(onSales)).toEqual(['name', 'tags', 'status']);
  });

  it('закріплене поле стоїть першим навіть якщо пресет ставить його далі', () => {
    const pinnedName = fields.map((field) =>
      field.id === 'name' ? { ...field, reorderable: false } : field,
    );
    expect(shown(onMain, pinnedName)).toEqual(['name', 'number', 'phone', 'status']);
  });

  it('поле, відсутнє в мапі Custom, бере свій defaultHidden', () => {
    const state = {
      ...INITIAL_FIELDS_STATE,
      activeSetId: CUSTOM_FIELD_SET_ID,
      custom: { visible: { number: false }, order: [] },
    };
    expect(shown(state)).toEqual(['name', 'phone', 'status']);
  });

  it('порожній результат падає на дефолти полів', () => {
    const onlyHideable: FieldMeta[] = [{ id: 'a' }, { id: 'b', defaultHidden: true }];
    const state = {
      activeSetId: CUSTOM_FIELD_SET_ID,
      preset: null,
      custom: { visible: { a: false, b: false }, order: [] },
    };
    expect([...resolveVisibility(onlyHideable, state)]).toEqual(['a']);
  });
});

describe('mergeOrder', () => {
  const declared = ['number', 'name', 'phone', 'website', 'status'];

  it('нове поле стає одразу після свого попередника з декларації', () => {
    expect(mergeOrder(['status', 'phone', 'name', 'number'], declared)).toEqual([
      'status',
      'phone',
      'website',
      'name',
      'number',
    ]);
  });

  it('поле без попередника в порядку — на початок; невідомі й дублікати — геть', () => {
    expect(mergeOrder(['ghost', 'name', 'name'], ['number', 'name'])).toEqual(['number', 'name']);
  });
});

describe('syncFieldSets', () => {
  it('нічого не обрано → застосовує перший набір', () => {
    expect(onMain.activeSetId).toBe('main');
    expect(shown(onMain)).toEqual(['number', 'name', 'phone', 'status']);
  });

  it('збережений id пресета без застосованого складу → застосовує його з коду', () => {
    const restored = synced({ ...INITIAL_FIELDS_STATE, activeSetId: 'sales' });
    expect(shown(restored)).toEqual(['name', 'tags', 'status']);
  });

  it('невідомий збережений id → перший набір', () => {
    expect(synced({ ...INITIAL_FIELDS_STATE, activeSetId: 'gone' }).activeSetId).toBe('main');
  });

  it('змінений у коді склад або порядок пресета застосовується заново', () => {
    const stale = { ...onSales, preset: { id: 'sales', fields: ['status', 'tags'] } };
    expect(shown(synced(stale))).toEqual(['name', 'tags', 'status']);
  });

  it('застосований пресет і активний Custom не чіпає', () => {
    expect(syncFieldSets(onMain, sets)).toBeNull();
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    expect(syncFieldSets(custom, sets)).toBeNull();
  });
});

describe('reduceFieldsState: видимість', () => {
  it('перша правка на пресеті переводить у Custom з уже застосованою правкою', () => {
    const next = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(shown(next)).toEqual(['number', 'name', 'status']);
  });

  it('правка без наборів полів теж веде в Custom', () => {
    const next = reduce(INITIAL_FIELDS_STATE, { type: 'toggle', fieldId: 'tags', visible: true });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(shown(next)).toEqual(['number', 'name', 'phone', 'status', 'tags']);
  });

  it('правка на Custom патчить його, лишаючись на Custom', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const next = reduce(custom, { type: 'toggle', fieldId: 'tags', visible: true });
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(shown(next)).toEqual(['number', 'name', 'status', 'tags']);
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
    expect(shown(back)).toEqual(shown(custom));
  });

  it('правка на іншому пресеті перебудовує Custom з нього (з його порядком)', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const switched = reduce(custom, {
      type: 'applyPreset',
      id: 'sales',
      fields: ['tags', 'status'],
    });
    const next = reduce(switched, { type: 'toggle', fieldId: 'number', visible: true });
    expect(shown(next)).toEqual(['number', 'name', 'tags', 'status']);
  });

  it('Custom, що збігся з пресетом, лишається Custom', () => {
    const custom = reduce(onMain, { type: 'toggle', fieldId: 'phone', visible: false });
    const same = reduce(custom, { type: 'toggle', fieldId: 'phone', visible: true });
    expect(same.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
  });

  it('reset прибирає Custom, а синхронізація повертає перший набір з його порядком', () => {
    const custom = reduce(onMain, move('status', 'number'));
    const reset = reduce(custom, { type: 'reset' });
    expect(reset.custom).toBeNull();
    expect(shown(synced(reset))).toEqual(['number', 'name', 'phone', 'status']);
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

describe('reduceFieldsState: порядок', () => {
  it('перестановка на пресеті форкає в Custom; сам пресет лишається своїм', () => {
    const next = reduce(onMain, move('status', 'phone'));
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(shown(next)).toEqual(['number', 'name', 'status', 'phone']);
    const back = synced({ ...next, activeSetId: 'main' });
    expect(shown(back)).toEqual(['number', 'name', 'phone', 'status']);
  });

  it('перестановка на Custom — на місці', () => {
    const custom = reduce(onMain, move('status', 'phone'));
    const next = reduce(custom, move('number', null));
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
    expect(shown(next)).toEqual(['name', 'status', 'phone', 'number']);
  });

  it('null ставить одразу за останнім показаним, а не за прихованими в хвості', () => {
    // tags прихований і стоїть останнім у повному порядку
    const next = reduce(onMain, move('number', null));
    expect(next.custom?.order).toEqual(['name', 'phone', 'status', 'number', 'tags']);
  });

  it('перестановка на те саме місце нічого не змінює і не форкає', () => {
    expect(reduce(onMain, move('phone', 'status'))).toBe(onMain);
  });

  it('закріплене не рухається, і перед закріпленим нічого не вставити', () => {
    const pinnedName = fields.map((field) =>
      field.id === 'name' ? { ...field, reorderable: false } : field,
    );
    const state = INITIAL_FIELDS_STATE;
    expect(reduceFieldsState(state, move('name', null), pinnedName)).toBe(state);
    expect(reduceFieldsState(state, move('status', 'name'), pinnedName)).toBe(state);
  });

  it('приховане й знову показане поле повертається на своє місце', () => {
    const custom = reduce(onMain, move('status', 'phone'));
    const hidden = reduce(custom, { type: 'toggle', fieldId: 'status', visible: false });
    const reshown = reduce(hidden, { type: 'toggle', fieldId: 'status', visible: true });
    expect(shown(reshown)).toEqual(['number', 'name', 'status', 'phone']);
  });

  it('нове поле з релізу стає за своїм попередником у збереженому порядку', () => {
    const custom = reduce(onMain, move('status', 'number'));
    const withWebsite: FieldMeta[] = [...fields.slice(0, 3), { id: 'website' }, ...fields.slice(3)];
    expect(shown(custom, withWebsite)).toEqual(['status', 'number', 'name', 'phone', 'website']);
  });
});

describe('stepMoveTarget', () => {
  const display = ['number', 'name', 'phone', 'status'];

  it('крок угору ставить перед попереднім, крок униз — перед наступним за сусідом', () => {
    expect(stepMoveTarget(display, 'status', -1, fields)).toEqual({ beforeId: 'phone' });
    expect(stepMoveTarget(display, 'number', 1, fields)).toEqual({ beforeId: 'phone' });
    expect(stepMoveTarget(display, 'phone', 1, fields)).toEqual({ beforeId: null });
  });

  it('на краю або для закріпленого — нікуди', () => {
    expect(stepMoveTarget(display, 'number', -1, fields)).toBeUndefined();
    expect(stepMoveTarget(display, 'status', 1, fields)).toBeUndefined();
    const pinnedName = fields.map((field) =>
      field.id === 'name' ? { ...field, reorderable: false } : field,
    );
    const pinnedDisplay = ['name', 'number', 'phone'];
    expect(stepMoveTarget(pinnedDisplay, 'name', 1, pinnedName)).toBeUndefined();
    expect(stepMoveTarget(pinnedDisplay, 'number', -1, pinnedName)).toBeUndefined();
  });
});

describe('sanitizeStoredFieldsState', () => {
  const roundTrip = (state: DataGridFieldsState): DataGridFieldsState =>
    sanitizeStoredFieldsState(JSON.parse(serializeFieldsState(state)), fields);

  it('переживає round-trip (з порядком); застосований пресет не зберігається', () => {
    const custom = reduce(onMain, move('status', 'phone'));
    expect(roundTrip(custom)).toEqual({ ...custom, preset: null });
    expect(roundTrip(onSales)).toEqual({ activeSetId: 'sales', preset: null, custom: null });
  });

  it('Custom як активний без самого Custom → нічого не обрано', () => {
    const raw = { v: 3, activeSetId: CUSTOM_FIELD_SET_ID, custom: null };
    expect(sanitizeStoredFieldsState(raw, fields).activeSetId).toBeNull();
  });

  it('відкидає невідомі, non-hideable і не-boolean ключі видимості та невідомі id порядку', () => {
    const raw = {
      v: 3,
      activeSetId: CUSTOM_FIELD_SET_ID,
      custom: {
        visible: { ghost: true, name: false, phone: 'yes', status: false },
        order: ['status', 'ghost', 7, 'status', 'number'],
      },
    };
    expect(sanitizeStoredFieldsState(raw, fields)).toEqual({
      activeSetId: CUSTOM_FIELD_SET_ID,
      preset: null,
      custom: { visible: { status: false }, order: ['status', 'number'] },
    });
  });

  it('v2 (голою мапою видимості) приймається, порядок виводиться з декларації', () => {
    const raw = { v: 2, activeSetId: CUSTOM_FIELD_SET_ID, custom: { phone: false, tags: true } };
    const state = sanitizeStoredFieldsState(raw, fields);
    expect(state.custom).toEqual({ visible: { phone: false, tags: true }, order: [] });
    expect(shown(state)).toEqual(['number', 'name', 'status', 'tags']);
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

describe('пошук у панелі полів', () => {
  const labelled = [
    { id: 'balanceDue', header: 'Balance due' },
    { id: 'billingEmail', header: 'Billing email' },
    { id: 'poNumber', header: 'PO number' },
  ];

  it('шукає за підписом і за id без урахування регістру', () => {
    expect(filterFieldsByQuery(labelled, 'BILL').map((f) => f.id)).toEqual(['billingEmail']);
    expect(filterFieldsByQuery(labelled, 'ponum').map((f) => f.id)).toEqual(['poNumber']);
    expect(filterFieldsByQuery(labelled, 'due').map((f) => f.id)).toEqual(['balanceDue']);
  });

  it('порожній запит — усі поля в тому ж порядку', () => {
    expect(filterFieldsByQuery(labelled, '  ')).toEqual(labelled);
  });

  it('пошук зʼявляється, коли полів більше за поріг', () => {
    expect(shouldShowFieldSearch(20)).toBe(false);
    expect(shouldShowFieldSearch(21)).toBe(true);
  });
});
