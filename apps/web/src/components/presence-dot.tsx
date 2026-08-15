interface PresenceDotProps {
  isOnline: boolean;
  /** Брокер недоступний — стан присутності невідомий */
  isUnknown: boolean;
  labels: { online: string; offline: string };
}

/**
 * Індикатор присутності. При `isUnknown` не рендериться взагалі — і це головне
 * рішення компонента: сірий кружечок читався б як «offline», тобто застосунок
 * стверджував би те, чого не знає. Відсутність індикатора чесніша.
 */
export function PresenceDot({ isOnline, isUnknown, labels }: PresenceDotProps) {
  if (isUnknown) {
    return null;
  }
  const label = isOnline ? labels.online : labels.offline;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={[
        'absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background',
        isOnline ? 'bg-success' : 'bg-muted',
      ].join(' ')}
    />
  );
}
