import { Trans, useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { NotificationResponseDtoOutput } from '../../../api/generated/model/notificationResponseDtoOutput';
import { notificationDefinition, textKeyBase } from '@saas-skeleton/contracts';
import { entityLink } from '../../../lib/entity-routes';
import { payloadValues } from '../../../lib/payload-values';

type Notification = NotificationResponseDtoOutput;

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
 * `<неймспейс власника типу>:…type.<тип з крапками як вкладеність>` — тексти календаря
 * живуть у `calendar.json`, платформні — у `notifications.json`; для схлопнутих груп
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
  // Визначення типу — з реєстру контрактів (docs/modules.md §7.1): там же,
  // у якому неймспейсі тексти і на яку сутність веде посилання. Невідомий тип — не
  // помилка: фронт може бути старіший за бекенд
  const definition = notificationDefinition(notification.type);

  if (!definition) {
    return <>{t('unknown')}</>;
  }

  const subject = definition.subject ? entityRef(payload, definition.subject) : null;
  const link = subject && !plain ? entityLink(subject.kind, subject.id) : null;

  return (
    <Trans
      t={t}
      i18nKey={`${textKeyBase(definition.texts)}type.${notification.type}`}
      count={notification.groupCount}
      values={{
        ...payloadValues(payload),
        actor: notification.actorLabel ?? t('system'),
        // AUTH-1: обидва поля бувають null (агент без User-Agent, невідомий ip) —
        // підставляємо чесне «unknown», а не порожнечу посеред речення
        deviceLabel: strField(payload, 'deviceLabel') || t('auth.unknownDevice'),
        ip: strField(payload, 'ip') || t('auth.unknownIp'),
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
