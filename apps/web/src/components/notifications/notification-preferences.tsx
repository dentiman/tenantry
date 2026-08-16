import { Button, Spinner } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  getNotificationsGetPreferencesQueryKey,
  useNotificationsGetPreferences,
  useNotificationsSetPreferences,
} from '../../api/generated/api';
import { CellSwitch } from '../data-grid/cell-switch';

/**
 * Налаштування інбокса: перемикач на тип. Матриця «тип × канал» уже закладена в
 * контракті, але канал у V1 рівно один, тому колонка не малюється.
 *
 * Немутабельні типи (security) приходять із бекенда з `muteable: false` — фронт
 * не тримає власного списку винятків, інакше вони розійшлися б.
 */
export function NotificationPreferences({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useNotificationsGetPreferences();
  const { mutate, isPending: isSaving } = useNotificationsSetPreferences({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getNotificationsGetPreferencesQueryKey() });
      },
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="self-start" onPress={onBack}>
        ← {t('settings.back')}
      </Button>

      {isPending && (
        <div className="flex justify-center py-8">
          <Spinner aria-label={t('loading')} />
        </div>
      )}
      {isError && <p className="py-4 text-sm text-danger">{t('loadError')}</p>}

      {data && (
        <ul className="flex flex-col gap-3">
          {data.items.map((pref) => (
            <li key={`${pref.type}:${pref.channel}`} className="flex items-center justify-between gap-3">
              {/* Окремий ключ-підпис, а не текст самого сповіщення: тому в ньому
                  немає ні розмітки, ні інтерполяцій, які тут нічим заповнити */}
              <span className="min-w-0 text-sm text-foreground">
                {t(`settings.label.${pref.type}`)}
              </span>
              {pref.muteable ? (
                <CellSwitch
                  label={pref.type}
                  isSelected={pref.enabled}
                  isDisabled={isSaving}
                  onChange={(enabled) => {
                    mutate({
                      data: { items: [{ type: pref.type, channel: pref.channel, enabled }] },
                    });
                  }}
                />
              ) : (
                <span className="shrink-0 text-xs text-muted">{t('settings.always')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
