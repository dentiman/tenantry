import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Field, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { UserSelect } from '../user-select';

type Attendee = CalendarEventResponse['attendees'][number];

interface AttendeePickerProps {
  /** Уже додані (у формі) — id-шники */
  value: string[];
  onChange: (next: string[]) => void;
  /** Ідентичності вже наявних учасників (з відповіді сервера) — для підписів */
  known: Attendee[];
  /** Організатор: його зі складу вибити неможливо (сервер це теж enforce-ить) */
  ownerId: string | null;
  disabled?: boolean;
}

/**
 * Вибір учасників. Свідомо НЕ multi-combobox: додаємо по одному через наявний
 * `UserSelect` (той самий серверний пошук, гідрація і фільтр неактивних), а
 * вибране показуємо списком із хрестиком.
 *
 * Причина не в лінощах: multi-режим Base UI довелося б обгортати своїм тригером
 * із чипами, тобто дублювати `UserSelect`. А «додав → бачу в списку» ще й
 * читабельніше на десятку людей, ніж чипи в один рядок.
 */
export function AttendeePicker({
  value,
  onChange,
  known,
  ownerId,
  disabled,
}: AttendeePickerProps) {
  const { t } = useTranslation('calendar');
  const byId = new Map(known.map((attendee) => [attendee.user.id, attendee]));

  return (
    <Field>
      <FieldLabel>{t('attendees.label')}</FieldLabel>
      <UserSelect
        value={null}
        allowUnassigned={false}
        placeholder={t('attendees.add')}
        disabled={disabled}
        onChange={(userId) => {
          if (userId && !value.includes(userId)) {
            onChange([...value, userId]);
          }
        }}
      />
      {value.length > 0 && (
        <ul className="flex flex-col gap-1 pt-1">
          {value.map((userId) => {
            const attendee = byId.get(userId);
            const isOwner = userId === ownerId;
            return (
              <li key={userId} className="flex items-start justify-between gap-2 rounded-md px-1 py-0.5">
                {attendee ? (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <UserIdentity
                      size="sm"
                      email={attendee.user.email}
                      name={attendee.user.name}
                      // Аватара в `CalendarUserRefSchema` поки немає: presigned URL
                      // на кожного учасника — це запит у сховище на рядок, і воно
                      // того не варте, доки список короткий. Вкладена форма це
                      // дозволяє додати одним полем, коли знадобиться
                      avatarUrl={null}
                    />
                    {/* Примітка до відповіді — те, що людина дописала до RSVP */}
                    {attendee.comment && (
                      <span className="truncate pl-7 text-xs text-muted-foreground">
                        “{attendee.comment}”
                      </span>
                    )}
                  </span>
                ) : (
                  // Щойно доданий — сервер ще не віддав його ідентичність
                  <span className="text-sm text-muted-foreground">{t('attendees.added')}</span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  {attendee && (
                    <RsvpBadge response={attendee.response} respondedAt={attendee.respondedAt} />
                  )}
                  {!isOwner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('attendees.remove')}
                      disabled={disabled}
                      onClick={() => {
                        onChange(value.filter((item) => item !== userId));
                      }}
                    >
                      <XIcon />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Field>
  );
}

/**
 * Бейдж відповіді. `respondedAt` іде в нативний `title`: «коли саме відповів» —
 * рідке питання, яке не варте власного рядка в списку, але й губити його не
 * можна (заднім числом цей момент не відновити). Той самий прийом, що
 * `title={name}` у `CustomerIdentity`.
 */
export function RsvpBadge({
  response,
  respondedAt = null,
}: {
  response: Attendee['response'];
  respondedAt?: string | null;
}) {
  const { t } = useTranslation('calendar');
  const title = respondedAt ? t('rsvp.respondedAt', { at: formatDateTime(respondedAt) }) : undefined;

  switch (response) {
    case 'ACCEPTED':
      return (
        <Badge variant="success" title={title}>
          {t('rsvp.accepted')}
        </Badge>
      );
    case 'DECLINED':
      return (
        <Badge variant="destructive" title={title}>
          {t('rsvp.declined')}
        </Badge>
      );
    case 'TENTATIVE':
      return (
        <Badge variant="warning" title={title}>
          {t('rsvp.tentative')}
        </Badge>
      );
    case 'NEEDS_ACTION':
      return <Badge variant="secondary">{t('rsvp.pending')}</Badge>;
  }
}
