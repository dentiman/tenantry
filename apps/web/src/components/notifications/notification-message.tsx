import { Trans, useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { NotificationResponseDtoOutput } from '../../api/generated/model/notificationResponseDtoOutput';
import { entityLink } from '../../lib/entity-routes';

type Notification = NotificationResponseDtoOutput;

// Типи, які фронт уміє рендерити явно; решта → generic-ключ (фронт може бути
// старіший за бекенд — панель не падає на невідомому типі)
const KNOWN_TYPES = [
  'user.created',
  'user.password_changed',
  'user.welcome',
  'customer.assigned',
  'calendar_event.invited',
  'calendar_event.rescheduled',
  'calendar_event.cancelled',
  'calendar_event.rsvp_changed',
  'calendar_event.reminder',
] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

function isKnown(type: string): type is KnownType {
  return KNOWN_TYPES.some((known) => known === type);
}

interface EntityRef {
  kind: string;
  id: string;
  label: string;
}

function entityRef(payload: Record<string, unknown>, key: string): EntityRef | null {
  const ref = payload[key];
  if (ref && typeof ref === 'object' && 'label' in ref && 'kind' in ref && 'id' in ref) {
    return { kind: String(ref.kind), id: String(ref.id), label: String(ref.label) };
  }
  return null;
}

function strField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Текст сповіщення — i18next у локалі юзера (бекенд шле код + payload). Ключ
 * `notifications:type.<тип з крапками як вкладеність>`; для схлопнутих груп
 * i18next сам бере плюральну форму за `count`.
 *
 * Тут же відбувається те, заради чого EntityRef несе `kind`+`id`: фронт зі знання
 * про сутність будує посилання і вкладає його ВСЕРЕДИНУ тексту. Невідомий kind —
 * не помилка: рендериться сам label.
 */
export function NotificationMessage({
  notification,
  plain = false,
}: {
  notification: Notification;
  /**
   * Без посилань. Потрібно в тості: він увесь — одна ціль кліку («відкрити
   * центр сповіщень»), і лінк усередині конкурував би з нею за клік.
   */
  plain?: boolean;
}) {
  const { t } = useTranslation('notifications');
  const payload = notification.payload;

  if (!isKnown(notification.type)) {
    return <>{t('unknown')}</>;
  }

  // Сутність, на яку веде текст: у user.* це юзер, у customer.* — кастомер.
  // Ключ у payload один на тип, тому беремо перший знайдений
  const subject =
    entityRef(payload, 'user') ?? entityRef(payload, 'customer') ?? entityRef(payload, 'event');
  const link = subject && !plain ? entityLink(subject.kind, subject.id) : null;

  return (
    <Trans
      t={t}
      i18nKey={`type.${notification.type}`}
      count={notification.groupCount}
      values={{
        actor: notification.actorLabel ?? t('system'),
        // Обидва імені вказують на ту саму сутність: ключ повідомлення вживає те,
        // яким сутність зветься в його тексті ({{user}} / {{customer}})
        user: subject?.label ?? '',
        customer: subject?.label ?? '',
        event: subject?.label ?? '',
        tenant: strField(payload, 'tenant'),
      }}
      components={{
        // <b> — просто акцент (актор, назва воркспейсу); <a> — сутність, на яку
        // фронт САМ будує посилання з {kind,id}. Різні теги, бо лінкувати актора
        // на сторінку сутності було б неправильно
        b: <b className="font-medium text-foreground" />,
        a: link ? (
          <Link
            {...link}
            className="font-medium text-primary underline-offset-4 hover:underline"
            // Щоб клік по сутності не спрацював ще й як «відкрити ціль сповіщення»
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        ) : (
          <b className="font-medium text-foreground" />
        ),
      }}
    />
  );
}
