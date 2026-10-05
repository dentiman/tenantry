import { ArrowLeft } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { notificationDefinition, textKeyBase } from '@saas-skeleton/contracts';
import {
  getNotificationsGetPreferencesQueryKey,
  useNotificationsGetPreferences,
  useNotificationsSetPreferences,
} from '../../api/generated/api';

/**
 * Налаштування інбокса: перемикач на тип. Матриця «тип × канал» уже закладена в
 * контракті, але канал у V1 рівно один, тому колонка не малюється.
 *
 * Немутабельні типи (security) приходять із бекенда з `muteable: false` — фронт
 * не тримає власного списку винятків, інакше вони розійшлися б.
 */
/** Підпис типу — у текстах модуля-власника (`calendar:notifications.label.…`) */
function preferenceLabelKey(type: string): string {
  const definition = notificationDefinition(type);
  return definition ? `${textKeyBase(definition.texts)}label.${type}` : 'unknown';
}

export function NotificationPreferences({ onBack }: { onBack?: () => void }) {
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
      {/* Кнопка «назад» — лише в панелі дзвінка; на сторінці налаштувань
          повертатись нікуди, тому onBack опційний */}
      {onBack && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeft />
          {t('settings.back')}
        </Button>
      )}

      {isPending && (
        <div className="flex justify-center py-8">
          <Spinner aria-label={t('loading')} />
        </div>
      )}
      {isError && <p className="py-4 text-sm text-destructive">{t('loadError')}</p>}

      {data && (
        <ul className="flex flex-col gap-3">
          {data.items.map((pref) => (
            <li
              key={`${pref.type}:${pref.channel}`}
              className="flex items-center justify-between gap-3"
            >
              {/* Окремий ключ-підпис, а не текст самого сповіщення: тому в ньому
                  немає ні розмітки, ні інтерполяцій, які тут нічим заповнити */}
              <span className="min-w-0 text-sm text-foreground">
                {t(preferenceLabelKey(pref.type))}
              </span>
              {pref.muteable ? (
                <Switch
                  aria-label={pref.type}
                  checked={pref.enabled}
                  disabled={isSaving}
                  onCheckedChange={(enabled) => {
                    mutate({
                      data: { items: [{ type: pref.type, channel: pref.channel, enabled }] },
                    });
                  }}
                />
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('settings.always')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
