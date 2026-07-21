import { Trans, useTranslation } from 'react-i18next';
import type { ActivityListResponseDtoOutputItemsItem } from '../../api/generated/model/activityListResponseDtoOutputItemsItem';

type Activity = ActivityListResponseDtoOutputItemsItem;

// Типи, які фронт вміє рендерити явно; решта → generic-ключ 'unknown' (фронт
// може бути старіший за бекенд — фід не падає на невідомому типі)
const KNOWN_TYPES = ['user.created', 'email.sent'] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

function isKnown(type: string): type is KnownType {
  return KNOWN_TYPES.some((known) => known === type);
}

/** Дістає label з EntityRef у payload (снапшот назви на момент події) */
function refLabel(payload: Record<string, unknown>, key: string): string {
  const ref = payload[key];
  if (ref && typeof ref === 'object' && 'label' in ref) {
    return String(ref.label);
  }
  return '';
}

function strField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Рендерить текст події через i18next у локалі юзера (i18n-доктрина: бекенд шле код +
 * payload, текст — фронт). Виділення <b> — через <Trans>, без dangerouslySetInnerHTML.
 * Дата НІКОЛИ не інтерполюється в повідомлення — вона окремо в ActivityDrawer (Intl).
 */
export function ActivityMessage({ activity }: { activity: Activity }) {
  const { t } = useTranslation('activities');
  const payload = activity.payload;

  if (!isKnown(activity.type)) {
    return <>{t('unknown', { type: activity.type })}</>;
  }

  const values =
    activity.type === 'user.created'
      ? { actor: activity.actorLabel ?? '', user: refLabel(payload, 'user') }
      : {
          template: strField(payload, 'template'),
          recipient: refLabel(payload, 'recipient'),
          email: strField(payload, 'email'),
        };

  return (
    <Trans
      t={t}
      i18nKey={activity.type}
      values={values}
      components={{ b: <b className="font-medium text-foreground" /> }}
    />
  );
}
