/**
 * Значення для інтерполяції тексту сповіщення чи активності з їхнього payload-а.
 *
 * Generic, без переліку полів: тексти фіч живуть у фічах (docs/module-registries.md R1), і
 * рендерер не має знати, які поля несе payload календаря. EntityRef (`{kind, id, label}`)
 * стає своїм label — снапшотом назви на момент події; `null` — порожнім рядком, щоб у
 * тексті не лишився сирий `{{owner}}`. Дати сюди потрапляють як ISO-рядки, але тексти їх не
 * інтерполюють — час рендериться окремо через Intl.
 */
export function payloadValues(payload: Record<string, unknown>): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number') {
      values[key] = value;
    } else if (value === null) {
      values[key] = '';
    } else if (typeof value === 'object' && 'label' in value) {
      values[key] = String(value.label);
    }
  }
  return values;
}
