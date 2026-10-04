/**
 * Гроші з API приходять ДЕСЯТКОВИМИ РЯДКАМИ (AI-5b, design.md R10). Intl.NumberFormat (ES2023)
 * приймає рядок як точне десяткове число, тож форматування не проходить через float.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${String(min)}:${String(max)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * Сума витрат: від цента й більше — 2 знаки, дрібніше — до 6, щоб вартість однієї
 * відповіді ($0.0004) не перетворювалась на $0.00
 */
export function formatUsd(value: string): string {
  const abs = value.replace(/^-/, '');
  const small = /^0(\.0\d*)?$/.test(abs) && abs !== '0';
  return formatter(2, small ? 6 : 2).format(value as `${number}`);
}

/** Ціна тарифу: як є, без округлення (до 10 знаків, як у `NUMERIC(18,10)`) */
export function formatPrice(value: string): string {
  return formatter(2, 10).format(value as `${number}`);
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
