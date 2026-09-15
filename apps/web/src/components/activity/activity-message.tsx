import { Trans, useTranslation } from 'react-i18next';
import type { ActivityListResponseDtoOutputItemsItem } from '../../api/generated/model/activityListResponseDtoOutputItemsItem';

type Activity = ActivityListResponseDtoOutputItemsItem;

// Типи, які фронт вміє рендерити явно; решта → generic-ключ 'unknown' (фронт
// може бути старіший за бекенд — фід не падає на невідомому типі)
const KNOWN_TYPES = [
  'user.created',
  'user.password_changed',
  'user.sessions_revoked',
  'user.enabled',
  'user.disabled',
  'user.email_changed',
  'email.sent',
  'customer.created',
  'customer.archived',
  'customer.restored',
  'customer.owner_changed',
  'customer.deleted',
  'settings.updated',
  'settings.numbering_shifted',
  'calendar_event.created',
  'calendar_event.rescheduled',
  'calendar_event.cancelled',
  'calendar_event.restored',
  'calendar_event.deleted',
  'calendar_event.attendee_added',
  'calendar_event.attendee_removed',
  'calendar_event.rsvp_changed',
] as const;
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

function numField(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
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

  // Зняття відповідального — не «призначення на null»: у людини це окрема фраза,
  // тому окремий ключ. Тип події при цьому один — журнал фільтрується по ньому
  const owner = payload.owner;
  let i18nKey: string =
    activity.type === 'customer.owner_changed' && owner === null
      ? 'customer.owner_cleared'
      : activity.type;

  // AUTH-1: «відкликано сесії» читається по-різному залежно від того, ЧОМУ це сталося:
  // один пристрій, усі пристрої чи система сама вбила підозрілу сесію. Тип події при
  // цьому один — журнал фільтрується по ньому, а розгалужується лише текст
  const reason = strField(payload, 'reason');
  if (activity.type === 'user.sessions_revoked' && reason !== '') {
    i18nKey = `user.sessions_revoked_${reason}`;
  }

  // Усі user.*-події мають однакову форму «хто зробив + над ким»: actorLabel —
  // снапшот того, хто натиснув (реальна людина доїжджає навіть у подіях, які
  // дописує worker), fallback — система, коли актора-людини не було
  const values =
    activity.type === 'email.sent'
      ? {
          template: strField(payload, 'template'),
          recipient: refLabel(payload, 'recipient'),
          email: strField(payload, 'email'),
        }
      : {
          actor: activity.actorLabel ?? t('system'),
          user: refLabel(payload, 'user'),
          customer: refLabel(payload, 'customer'),
          owner: refLabel(payload, 'owner'),
          // Календар: назва події — снапшот, учасник — теж EntityRef.
          // Дати сюди НЕ інтерполюються (доктрина: час рендериться окремо через Intl)
          event: refLabel(payload, 'event'),
          attendee: refLabel(payload, 'attendee'),
          response: strField(payload, 'response'),
          // Налаштування — не сутність із EntityRef: у payload прості скаляри
          section: strField(payload, 'section'),
          series: strField(payload, 'series'),
          nextNumber: numField(payload, 'nextNumber'),
          // Лише один тип має додаткове число — плодити окрему гілку заради нього
          // немає сенсу, зайвий ключ у values інші повідомлення просто ігнорують
          sessionCount: numField(payload, 'sessionCount'),
          // AUTH-3: user.email_changed — адреси прості скаляри, не EntityRef
          from: strField(payload, 'from'),
          to: strField(payload, 'to'),
        };

  return (
    <Trans
      t={t}
      i18nKey={i18nKey}
      values={values}
      components={{ b: <b className="font-medium text-foreground" /> }}
    />
  );
}
