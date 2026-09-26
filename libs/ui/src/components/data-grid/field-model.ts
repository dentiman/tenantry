import { CUSTOM_FIELD_SET_ID } from './types';
import type { DataGridCustomFieldSet, DataGridFieldSet, DataGridFieldsState } from './types';

/**
 * Чиста логіка видимості й порядку полів: без React і без сховища — тому тестується в node.
 *
 * Шари як у MUI X/TanStack: `Grid.Root` тримає лише стан полів (застосований пресет
 * або Custom) і НЕ знає, що таке Main чи Sales. Пресети — справа `Grid.FieldSets`:
 * він записує в Root розвʼязаний список полів. Меню полів і заголовки таблиці лише
 * емітять toggle/move; «ручна правка = Custom» — загальне правило Root.
 *
 * Видимість і порядок — дві осі: видимість — множина, порядок — список УСІХ полів
 * (приховані теж мають місце, тож повертаються туди, де були).
 */

/** Те, що моделі треба знати про поле — без cell/header, щоб не залежати від TItem */
export interface FieldMeta {
  id: string;
  hideable?: boolean;
  defaultHidden?: boolean;
  reorderable?: boolean;
}

export type FieldsAction =
  | { type: 'toggle'; fieldId: string; visible: boolean }
  /** Поставити поле перед `beforeId`; null — одразу після останнього ПОКАЗАНОГО поля */
  | { type: 'move'; fieldId: string; beforeId: string | null }
  | { type: 'applyPreset'; id: string; fields: string[] }
  | { type: 'selectCustom' }
  | { type: 'reset' };

export const INITIAL_FIELDS_STATE: DataGridFieldsState = {
  activeSetId: null,
  preset: null,
  custom: null,
};

export function isHideable(field: FieldMeta): boolean {
  return field.hideable !== false;
}

export function isPinned(field: FieldMeta): boolean {
  return field.reorderable === false;
}

function withNonHideable(fields: readonly FieldMeta[], visible: Set<string>): Set<string> {
  for (const field of fields) {
    if (!isHideable(field)) {
      visible.add(field.id);
    }
  }
  return visible;
}

function defaultVisibility(fields: readonly FieldMeta[]): Set<string> {
  return new Set(fields.filter((field) => !field.defaultHidden).map((field) => field.id));
}

function isCustomActive(
  state: DataGridFieldsState,
): state is DataGridFieldsState & { custom: DataGridCustomFieldSet } {
  return state.activeSetId === CUSTOM_FIELD_SET_ID && state.custom !== null;
}

function isPresetActive(
  state: DataGridFieldsState,
): state is DataGridFieldsState & { preset: { id: string; fields: string[] } } {
  return state.preset !== null && state.preset.id === state.activeSetId;
}

/**
 * Множина видимих id полів (без порядку — порядок дає `resolveFields`).
 * Порожній результат (зіпсоване сховище, пресет лише з невідомих id) падає на
 * дефолти полів, а якщо й ті порожні — на всі поля: порожня таблиця — не стан.
 */
export function resolveVisibility(
  fields: readonly FieldMeta[],
  state: DataGridFieldsState,
): Set<string> {
  let visible: Set<string>;
  if (isCustomActive(state)) {
    const map = state.custom.visible;
    visible = new Set(
      fields.filter((field) => map[field.id] ?? !field.defaultHidden).map((field) => field.id),
    );
  } else if (isPresetActive(state)) {
    const listed = new Set(state.preset.fields);
    visible = new Set(fields.filter((field) => listed.has(field.id)).map((field) => field.id));
  } else {
    visible = defaultVisibility(fields);
  }
  withNonHideable(fields, visible);

  if (visible.size === 0) {
    visible = withNonHideable(fields, defaultVisibility(fields));
  }
  if (visible.size === 0) {
    visible = new Set(fields.map((field) => field.id));
  }
  return visible;
}

/**
 * Доповнює порядок до ВСІХ оголошених полів: невідомі id викидаються (і дублікати),
 * а кожне оголошене поле, якого в порядку немає (новий реліз, дані без порядку,
 * пресет, що не перелічує поле), стає одразу після найближчого попередника з
 * декларації, який у порядку вже є, — або на початок, якщо такого немає.
 */
export function mergeOrder(order: readonly string[], declared: readonly string[]): string[] {
  const declaredSet = new Set(declared);
  const result: string[] = [];
  for (const id of order) {
    if (declaredSet.has(id) && !result.includes(id)) {
      result.push(id);
    }
  }
  declared.forEach((id, index) => {
    if (result.includes(id)) {
      return;
    }
    let insertAt = 0;
    for (let prev = index - 1; prev >= 0; prev -= 1) {
      const anchor = result.indexOf(declared[prev] ?? '');
      if (anchor !== -1) {
        insertAt = anchor + 1;
        break;
      }
    }
    result.splice(insertAt, 0, id);
  });
  return result;
}

/** Закріплені поля — першими, у порядку декларації; решта — як є */
function withPinnedFirst(order: readonly string[], fields: readonly FieldMeta[]): string[] {
  const pinned = fields.filter(isPinned).map((field) => field.id);
  return [...pinned, ...order.filter((id) => !pinned.includes(id))];
}

/**
 * Повний порядок (усі оголошені поля, показані й приховані) для поточного стану:
 * Custom — його збережений порядок; пресет — його список, решта полів злита на
 * місця за декларацією; інакше — декларація. Закріплені завжди першими.
 */
export function fullOrder(fields: readonly FieldMeta[], state: DataGridFieldsState): string[] {
  const declared = fields.map((field) => field.id);
  let base: readonly string[] = declared;
  if (isCustomActive(state)) {
    base = state.custom.order;
  } else if (isPresetActive(state)) {
    base = state.preset.fields;
  }
  return withPinnedFirst(mergeOrder(base, declared), fields);
}

/** Видимі id у порядку показу — те, що рендерить таблиця (і майбутні картки) */
export function resolveFields(fields: readonly FieldMeta[], state: DataGridFieldsState): string[] {
  const visible = resolveVisibility(fields, state);
  return fullOrder(fields, state).filter((id) => visible.has(id));
}

/** Чи можна сховати поле: останнє видиме лишається (меню його дизейблить) */
export function canHideField(visible: ReadonlySet<string>, fieldId: string): boolean {
  return !visible.has(fieldId) || visible.size > 1;
}

function customFrom(
  fields: readonly FieldMeta[],
  visible: ReadonlySet<string>,
  order: string[],
): DataGridCustomFieldSet {
  // У мапу видимості — лише hideable-поля: non-hideable видимі завжди
  return {
    visible: Object.fromEntries(
      fields.filter(isHideable).map((field) => [field.id, visible.has(field.id)]),
    ),
    order,
  };
}

/**
 * Куди поставити поле при кроці ±1 серед показаних (клавіатура в меню полів):
 * `beforeId` для дії `move`, або undefined — рухатись нікуди (край чи закріплене).
 */
export function stepMoveTarget(
  displayIds: readonly string[],
  fieldId: string,
  delta: -1 | 1,
  fields: readonly FieldMeta[],
): { beforeId: string | null } | undefined {
  const from = displayIds.indexOf(fieldId);
  const field = fields.find((candidate) => candidate.id === fieldId);
  if (from === -1 || !field || isPinned(field)) {
    return undefined;
  }
  const pinned = new Set(fields.filter(isPinned).map((candidate) => candidate.id));
  const firstFree = displayIds.findIndex((id) => !pinned.has(id));
  const to = Math.max(firstFree, Math.min(displayIds.length - 1, from + delta));
  if (to === from) {
    return undefined;
  }
  const without = displayIds.filter((id) => id !== fieldId);
  return { beforeId: without[to] ?? null };
}

export function reduceFieldsState(
  state: DataGridFieldsState,
  action: FieldsAction,
  fields: readonly FieldMeta[],
): DataGridFieldsState {
  switch (action.type) {
    case 'toggle': {
      const field = fields.find((candidate) => candidate.id === action.fieldId);
      if (!field || !isHideable(field)) {
        return state;
      }
      const visible = resolveVisibility(fields, state);
      if (visible.has(field.id) === action.visible) {
        return state;
      }
      if (!action.visible && !canHideField(visible, field.id)) {
        return state;
      }
      if (action.visible) {
        visible.add(field.id);
      } else {
        visible.delete(field.id);
      }
      // Будь-яка ручна правка — це Custom: з пресета — його копія (видимість і
      // порядок) з уже застосованою правкою, на Custom — він сам зі зміною
      return {
        ...state,
        activeSetId: CUSTOM_FIELD_SET_ID,
        custom: customFrom(fields, visible, fullOrder(fields, state)),
      };
    }
    case 'move': {
      const field = fields.find((candidate) => candidate.id === action.fieldId);
      const before =
        action.beforeId === null
          ? undefined
          : fields.find((candidate) => candidate.id === action.beforeId);
      if (!field || isPinned(field) || action.beforeId === action.fieldId) {
        return state;
      }
      // Перед закріпленим вставити не можна: «закріплене на початку» інакше брехало б
      if (action.beforeId !== null && (!before || isPinned(before))) {
        return state;
      }
      const visible = resolveVisibility(fields, state);
      const current = fullOrder(fields, state);
      const without = current.filter((id) => id !== field.id);
      let insertAt: number;
      if (action.beforeId === null) {
        // Не в абсолютний кінець, а одразу за останнім ПОКАЗАНИМ: приховані поля
        // в хвості лишаються на своїх місцях
        const lastShown = without.findLastIndex((id) => visible.has(id));
        insertAt = lastShown + 1;
      } else {
        insertAt = without.indexOf(action.beforeId);
      }
      const order = [...without.slice(0, insertAt), field.id, ...without.slice(insertAt)];
      if (order.every((id, index) => id === current[index])) {
        return state;
      }
      return {
        ...state,
        activeSetId: CUSTOM_FIELD_SET_ID,
        custom: customFrom(fields, visible, order),
      };
    }
    case 'applyPreset':
      // Custom лишається: повернутись до нього можна кліком по табу
      return { ...state, activeSetId: action.id, preset: { id: action.id, fields: action.fields } };
    case 'selectCustom':
      return state.custom === null ? state : { ...state, activeSetId: CUSTOM_FIELD_SET_ID };
    case 'reset':
      // Дефолтний пресет Root не знає: null → FieldSets (якщо він є) застосує перший набір,
      // без FieldSets лишаються дефолти полів
      return INITIAL_FIELDS_STATE;
  }
}

/**
 * Що має зробити `Grid.FieldSets`, щоб стан Root відповідав його пресетам: null —
 * нічого. Активний Custom не чіпає; відомий пресет, ще не застосований (або з іншим
 * складом чи порядком — код змінився), застосовує заново; невідомий id або null — перший набір.
 */
export function syncFieldSets(
  state: DataGridFieldsState,
  sets: readonly DataGridFieldSet[],
): FieldsAction | null {
  const first = sets[0];
  if (!first) {
    return null;
  }
  if (state.activeSetId === CUSTOM_FIELD_SET_ID && state.custom !== null) {
    return null;
  }
  const active = sets.find((set) => set.id === state.activeSetId) ?? first;
  const isApplied =
    state.activeSetId === active.id &&
    state.preset?.id === active.id &&
    state.preset.fields.join('\u0000') === active.fields.join('\u0000');
  return isApplied ? null : { type: 'applyPreset', id: active.id, fields: active.fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Версія збереженого формату. v2 (видимість без порядку) ще приймається */
export const STORED_FIELDS_STATE_VERSION = 3;

function sanitizeVisibleMap(
  raw: Record<string, unknown>,
  fields: readonly FieldMeta[],
): Record<string, boolean> {
  return Object.fromEntries(
    fields.filter(isHideable).flatMap((field) => {
      const value = raw[field.id];
      return typeof value === 'boolean' ? [[field.id, value] as const] : [];
    }),
  );
}

/**
 * Збережене ззовні (localStorage) — недовірене: форма могла змінитись, поля сторінки —
 * теж. Ключі видимості, яких сторінка більше не оголошує (або non-hideable), і невідомі
 * id порядку відкидаються; v2 (голою мапою видимості) → порядок виведеться з декларації
 * (`mergeOrder` порожнього порядку). Id пресета Root перевірити не може — його відсіє FieldSets.
 */
export function sanitizeStoredFieldsState(
  raw: unknown,
  fields: readonly FieldMeta[],
): DataGridFieldsState {
  if (!isRecord(raw) || (raw.v !== STORED_FIELDS_STATE_VERSION && raw.v !== 2)) {
    return INITIAL_FIELDS_STATE;
  }

  const declared = new Set(fields.map((field) => field.id));
  let custom: DataGridCustomFieldSet | null = null;
  if (raw.v === 2 && isRecord(raw.custom)) {
    custom = { visible: sanitizeVisibleMap(raw.custom, fields), order: [] };
  } else if (isRecord(raw.custom) && isRecord(raw.custom.visible)) {
    const storedOrder = Array.isArray(raw.custom.order) ? (raw.custom.order as unknown[]) : [];
    custom = {
      visible: sanitizeVisibleMap(raw.custom.visible, fields),
      order: storedOrder.filter(
        (id, index): id is string =>
          typeof id === 'string' && declared.has(id) && storedOrder.indexOf(id) === index,
      ),
    };
  }

  const active = raw.activeSetId;
  const activeSetId =
    typeof active !== 'string' || (active === CUSTOM_FIELD_SET_ID && custom === null)
      ? null
      : active;

  return { activeSetId, preset: null, custom };
}

export function serializeFieldsState(state: DataGridFieldsState): string {
  return JSON.stringify({
    v: STORED_FIELDS_STATE_VERSION,
    activeSetId: state.activeSetId,
    custom: state.custom,
  });
}

/**
 * Помилки конфігурації наборів полів — для попереджень у FieldSets. Не кидає: грід
 * має рендеритись і з кривим конфігом (resolveVisibility має фолбеки).
 */
export function validateFieldSets(
  fields: readonly FieldMeta[],
  sets: readonly DataGridFieldSet[],
): string[] {
  const problems: string[] = [];
  const declared = new Set(fields.map((field) => field.id));
  for (const set of sets) {
    if (set.id === CUSTOM_FIELD_SET_ID) {
      problems.push(`Field set id "${CUSTOM_FIELD_SET_ID}" is reserved for the Custom set`);
    }
    for (const fieldId of set.fields) {
      if (!declared.has(fieldId)) {
        problems.push(`Field set "${set.id}" references undeclared field "${fieldId}"`);
      }
    }
  }
  return problems;
}

/**
 * Скільки полів має бути в гріді, щоб панель полів показала пошук. Рахуються ВСІ поля,
 * а не приховані: інакше пошук зникав би під рукою, щойно людина покаже кілька полів,
 * хоча список лишився б тим самим довгим.
 */
export const FIELD_SEARCH_THRESHOLD = 20;

export function shouldShowFieldSearch(fieldCount: number): boolean {
  return fieldCount > FIELD_SEARCH_THRESHOLD;
}

/**
 * Фільтр панелі полів: збіг за підписом (те, що людина бачить) або за id поля (те, що
 * видно в URL сортування, коді й розмовах із розробниками), без урахування регістру.
 */
export function filterFieldsByQuery<T extends { id: string; header: string }>(
  fields: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...fields];
  }
  return fields.filter(
    (field) =>
      field.header.toLowerCase().includes(needle) || field.id.toLowerCase().includes(needle),
  );
}
