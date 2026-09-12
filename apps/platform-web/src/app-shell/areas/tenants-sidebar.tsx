import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaNav } from '../area-nav';

/**
 * Друга колонка area «Tenants» — клієнти платформи.
 *
 * Один пункт — це легально: контракт `AppArea.Sidebar` — компонент-контейнер
 * area, а не підменю (найяскравіше видно на порожньому `ChatSidebar` у web).
 * Тут вона наповнюється на MT-4 (оператори, сегменти тенантів).
 */
export function TenantsSidebar() {
  const { t } = useTranslation('layout');

  return (
    <AreaNav
      items={[
        { to: '/tenants', label: t('nav.allTenants'), icon: <Building2 />, match: 'exact' },
      ]}
    />
  );
}
