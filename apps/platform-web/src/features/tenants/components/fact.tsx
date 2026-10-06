import type { ReactNode } from 'react';

/** Рядок «підпис → значення»: та сама форма, що на картці юзера в apps/web */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}
