import { useState } from 'react';
import { DownloadIcon } from 'lucide-react';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { parseApiError, isGlobalApiError } from '@saas-skeleton/ui/api/api-error';
import { customersExport } from '../../../api/generated/api';
import type { ExportCustomersDto } from '../../../api/generated/model/exportCustomersDto';
import { trackUserOperation } from '../../user-operations/user-operations.source';
import { CustomersSearchSchema } from '../customers.routes';

/** Фільтри гріда без пагінації — ті самі, що бачить список (openspec: customers/export) */
export function exportFiltersFromSearch(search: unknown): ExportCustomersDto {
  const { page: _page, limit: _limit, ...filters } = CustomersSearchSchema.parse(search ?? {});
  return filters;
}

/**
 * Експорт поточного списку клієнтів у CSV. Запит лише ставить операцію (202) — файл будує
 * воркер, прогрес і кнопка «Download» зʼявляються в лотку активності. `Idempotency-Key`
 * HTTP-клієнт ставить сам, тож подвійний клік не створить двох експортів.
 */
export function ExportCustomersButton() {
  const { t } = useTranslation('user-operations');
  const search = useSearch({ strict: false });
  const [isPending, setPending] = useState(false);

  const start = async (): Promise<void> => {
    setPending(true);
    try {
      trackUserOperation(await customersExport(exportFiltersFromSearch(search)));
    } catch (error) {
      const parsed = parseApiError(error);
      const tooLarge = parsed.fieldErrors.find((field) => field.code === 'export_too_large');
      if (tooLarge) {
        toast.add({
          type: 'error',
          title: t('export.tooLarge', { maximum: tooLarge.params?.maximum ?? '' }),
        });
      } else if (!isGlobalApiError(parsed)) {
        toast.add({ type: 'error', title: parsed.message });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={isPending}
      onClick={() => {
        void start();
      }}
    >
      {t('actions.export')}
      <DownloadIcon />
    </Button>
  );
}
