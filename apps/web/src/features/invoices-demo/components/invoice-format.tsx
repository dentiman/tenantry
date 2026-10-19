import { toast } from '@saas-skeleton/ui/components/ui/toast';
import type { TFunction } from 'i18next';
import { CURRENCY } from '../data/mock-invoices';

const moneyFormat = new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY });

export function formatMoney(value: number): string {
  return moneyFormat.format(value);
}

/** `2026-10` → `Oct 2026`: місяць нарахування читається словом, а не числом */
export function formatMonth(value: string): string {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function Money({ value }: { value: number }) {
  return <span className="tabular-nums">{formatMoney(value)}</span>;
}

/** Порожнє значення — тире приглушеним кольором, як у решти гридів */
export function Muted({ value }: { value: string | number | null }) {
  return value === null || value === '' ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{value}</span>
  );
}

/**
 * Усі дії сторінки — заглушки: замість виклику API лише тост. Один хелпер, щоб коли
 * дія стане справжньою, її було видно як «ще демо» пошуком по коду.
 */
export function notImplemented(description: string, t: TFunction<'invoices-demo'>): void {
  toast.add({ type: 'info', title: t('demoToast.title'), description });
}
