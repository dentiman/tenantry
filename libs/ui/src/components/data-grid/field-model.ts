import { CUSTOM_FIELD_SET_ID } from './types';
import type { DataGridFieldSet, DataGridFieldsState } from './types';

/**
 * Чиста логіка видимості полів: без React і без сховища — тому тестується в node.
 *
 * Шари як у MUI X/TanStack: `Grid.Root` тримає лише видимість (мапу/застосований
 * пресет) і НЕ знає, що таке Main чи Sales. Пресети — справа `Grid.FieldSets`:
 * він записує в Root розвʼязаний список полів. Меню полів лише емітить toggle;
 * «ручна правка = Custom» — загальне правило Root, не знання про пресети.
 */

/** Те, що моделі треба знати про поле — без cell/header, щоб не залежати від TItem */
export interface FieldMeta {
  id: string;
  hideable?: boolean;
  defaultHidden?: boolean;
}

export type FieldsAction =
  | { type: 'toggle'; fieldId: string; visible: boolean }
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

/**
 * Множина видимих id полів. Порядок рендера — НЕ звідси: рендерер фільтрує
 * декларацію полів цією множиною, тож порядок завжди як у декларації.
 * Порожній результат (зіпсоване сховище, пресет лише з невідомих id) падає на
 * дефолти полів, а якщо й ті порожні — на всі поля: порожня таблиця — не стан.
 */
export function resolveVisibility(
  fields: readonly FieldMeta[],
  state: DataGridFieldsState,
): Set<string> {
  let visible: Set<string>;
  if (state.activeSetId === CUSTOM_FIELD_SET_ID && state.custom !== null) {
    const custom = state.custom;
    visible = new Set(
      fields.filter((field) => custom[field.id] ?? !field.defaultHidden).map((field) => field.id),
    );
  } else if (state.preset !== null && state.preset.id === state.activeSetId) {
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

/** Чи можна сховати поле: останнє видиме лишається (меню його дизейблить) */
export function canHideField(visible: ReadonlySet<string>, fieldId: string): boolean {
  return !visible.has(fieldId) || visible.size > 1;
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
      // Будь-яка ручна правка — це Custom: з пресета — його копія з уже
      // застосованою правкою, на Custom — та сама мапа з одним зміненим значенням.
      // Записуються лише hideable-поля: non-hideable видимі завжди
      const custom = Object.fromEntries(
        fields.filter(isHideable).map((candidate) => [candidate.id, visible.has(candidate.id)]),
      );
      return { ...state, activeSetId: CUSTOM_FIELD_SET_ID, custom };
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
 * складом — код змінився), застосовує заново; невідомий id або null — перший набір.
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

/** Версія збереженого формату; інша — стан ігнорується (дефолт) */
export const STORED_FIELDS_STATE_VERSION = 2;

/**
 * Збережене ззовні (localStorage) — недовірене: форма могла змінитись, поля сторінки —
 * теж. Ключі Custom, яких сторінка більше не оголошує (або non-hideable), відкидаються.
 * Id пресета Root перевірити не може (не знає пресетів) — невідомий відсіє FieldSets.
 */
export function sanitizeStoredFieldsState(
  raw: unknown,
  fields: readonly FieldMeta[],
): DataGridFieldsState {
  if (!isRecord(raw) || raw.v !== STORED_FIELDS_STATE_VERSION) {
    return INITIAL_FIELDS_STATE;
  }

  let custom: Record<string, boolean> | null = null;
  if (isRecord(raw.custom)) {
    const storedCustom = raw.custom;
    custom = Object.fromEntries(
      fields.filter(isHideable).flatMap((field) => {
        const value = storedCustom[field.id];
        return typeof value === 'boolean' ? [[field.id, value] as const] : [];
      }),
    );
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
