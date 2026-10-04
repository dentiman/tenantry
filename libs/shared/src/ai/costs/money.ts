/**
 * Гроші з JSON → десятковий рядок на МЕЖІ парсингу (AI-5b, design.md R4). `String(n)` дає
 * найкоротше подання, що відтворює те саме число, — тобто літерал із відповіді провайдера;
 * далі лише `Prisma.Decimal`, жодної float-арифметики
 */
export function decimalString(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? toPlainDecimal(value) : undefined;
  }
  // Рядок (так OpenRouter віддає ціни) — лише звичайний десятковий запис, як є
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return undefined;
}

/** Без експоненти: `1e-7` → `0.0000001` (Decimal зрозуміє обидва, але люди й логи — ні) */
function toPlainDecimal(value: number): string {
  const text = String(value);
  if (!/e/i.test(text)) {
    return text;
  }
  const [mantissa = '0', exponentText = '0'] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const [intPart = '0', fracPart = ''] = mantissa.split('.');
  const digits = intPart + fracPart;
  const point = intPart.length + exponent;
  if (point <= 0) {
    return `0.${'0'.repeat(-point)}${digits}`.replace(/\.?0+$/, '');
  }
  if (point >= digits.length) {
    return digits + '0'.repeat(point - digits.length);
  }
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
