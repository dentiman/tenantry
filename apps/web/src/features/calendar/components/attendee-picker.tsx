import { useTranslation } from 'react-i18next';
import { MessageSquareTextIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Field, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { UserMultiList, UserRowNote } from '../../users/components/user-multi-select';

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
 * Вибір учасників події — тонка обгортка над `UserMultiList`
 * (`docs/frontend/multi-user-select.md`).
 *
 * До 2026-09-07 тут жила власна конструкція «додаємо по одному через `UserSelect`,
 * вибране показуємо списком нижче»: поле завжди стояло порожнім, і єдиною його
 * роботою було ЗНИКАТИ значення після кожного вибору. Тепер поля немає взагалі —
 * список і є контролом.
 *
 * Доменного тут лишилось рівно три речі, і всі три їдуть у слоти:
 * організатор (`lockedIds`), відповідь на запрошення і коментар до неї
 * (`renderRowEnd`). Про учасників, RSVP і календар компонент списку не знає нічого.
 *
 * **`reorderable` свідомо не вмикається**: сервер віддає склад відсортованим, і
 * порядок, у якому людина розставила рядки, нікуди не збережеться — ручка
 * обіцяла б те, чого API не робить.
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
      <UserMultiList
        value={value}
        onChange={onChange}
        disabled={disabled}
        addLabel={t('attendees.add')}
        removeLabel={t('attendees.remove')}
        lockedIds={ownerId ? [ownerId] : []}
        // Аватара в `CalendarUserRefSchema` немає: presigned URL на кожного
        // учасника — це запит у сховище на рядок, і воно того не варте, доки
        // список короткий. Якщо юзер трапиться і в результатах пошуку, кеш
        // ідентичностей візьме звідти багатшу версію — з аватаром
        known={known.map((attendee) => ({
          id: attendee.user.id,
          email: attendee.user.email,
          name: attendee.user.name,
          avatarUrl: null,
        }))}
        renderRowEnd={(option) => {
          const attendee = byId.get(option.id);
          // Щойно доданий: сервер ще не знає про нього, тож ні відповіді, ні
          // коментаря не існує — правий край рядка лишається порожнім
          if (!attendee) {
            return null;
          }
          return (
            <>
              {attendee.comment && (
                <UserRowNote
                  label={t('attendees.comment')}
                  icon={<MessageSquareTextIcon />}
                >
                  {attendee.comment}
                </UserRowNote>
              )}
              <RsvpBadge response={attendee.response} respondedAt={attendee.respondedAt} />
            </>
          );
        }}
      />
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
