import { Trans, useTranslation } from 'react-i18next';
import { activityDefinition, textKeyBase } from '@saas-skeleton/contracts';
import type { ActivityListResponseDtoOutputItemsItem } from '../../../api/generated/model/activityListResponseDtoOutputItemsItem';
import { payloadValues } from '../../../lib/payload-values';

type Activity = ActivityListResponseDtoOutputItemsItem;

/**
 * Рендерить текст події через i18next у локалі юзера (i18n-доктрина: бекенд шле код +
 * payload, текст — фронт). Виділення <b> — через <Trans>, без dangerouslySetInnerHTML.
 * Дата НІКОЛИ не інтерполюється в повідомлення — вона окремо в ActivityDrawer (Intl).
 *
 * Що це за тип, де його тексти і чи має він інший варіант фрази — з визначення в
 * контрактах власника (docs/modules.md §7.1): тексти календаря живуть у
 * `calendar.json`, платформні — у `activities.json`. Невідомий тип — generic-ключ
 * `unknown`: фронт може бути старіший за бекенд, і фід не падає.
 */
export function ActivityMessage({ activity }: { activity: Activity }) {
  const { t } = useTranslation('activities');
  const payload = activity.payload;
  const definition = activityDefinition(activity.type);

  if (!definition) {
    return <>{t('unknown', { type: activity.type })}</>;
  }

  // Тип події один — журнал фільтрується по ньому, — а фраза може залежати від payload-а
  // («зняв відповідального» замість «призначив null»)
  const key = definition.textVariant?.(payload) ?? activity.type;

  return (
    <Trans
      t={t}
      i18nKey={`${textKeyBase(definition.texts)}${key}`}
      values={{
        ...payloadValues(payload),
        // actorLabel — снапшот того, хто натиснув (реальна людина доїжджає навіть у подіях,
        // які дописує worker); fallback — система, коли актора-людини не було
        actor: activity.actorLabel ?? t('system'),
      }}
      components={{ b: <b className="font-medium text-foreground" /> }}
    />
  );
}
