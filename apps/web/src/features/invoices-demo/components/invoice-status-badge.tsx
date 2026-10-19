import { useTranslation } from 'react-i18next';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import type { InvoiceStatus } from '../data/mock-invoices';

const STATUS_VARIANT: Record<InvoiceStatus, 'success' | 'secondary' | 'outline' | 'warning'> = {
  NEW: 'secondary',
  IN_COLLECTION: 'warning',
  PAID: 'success',
  CANCELED: 'outline',
};

/**
 * `xs` — для другого рядка композитної клітинки: у реєстровому Badge одна висота (h-5),
 * тож зменшення — класом тут, а не правкою вендорного примітива
 */
export const XS_BADGE = 'h-4 px-1.5 py-0 text-[10px] leading-none';

export function InvoiceStatusBadge({
  status,
  size = 'default',
}: {
  status: InvoiceStatus;
  size?: 'default' | 'xs';
}) {
  const { t } = useTranslation('invoices-demo');
  return (
    <Badge variant={STATUS_VARIANT[status]} className={size === 'xs' ? XS_BADGE : undefined}>
      {t(`status.${status}`)}
    </Badge>
  );
}
