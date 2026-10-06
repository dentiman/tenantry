import { LayoutGrid, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../../app-shell/area-nav';

/**
 * Друга колонка area «Operations» — машинерія системи (моніторинг черг).
 * Росте на EDA-2 (DLQ, replay, лаг черг) — той самий аргумент, яким Settings у
 * web стали окремою area.
 */
export function OperationsSidebar() {
  const { t } = useTranslation('layout');

  return (
    <AreaNav
      items={[
        { to: '/operations/jobs', label: t('nav.jobs'), icon: <ListChecks /> },
        { to: '/operations/queues', label: t('nav.queues'), icon: <LayoutGrid /> },
      ]}
    />
  );
}
