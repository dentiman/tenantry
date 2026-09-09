import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindWindowQueryKey,
  useCalendarRemove,
  useCalendarSetRsvp,
  useCalendarSetStatus,
} from '../../api/generated/api';
import type { EventIntent } from './event-context-menu';
import type { EventPanelTarget } from './event-panel';

/** Чернетка панелі події — те, з чим відкривається форма «Duplicate» */
export type EventDraft = NonNullable<EventPanelTarget['draft']>;

/**
 * Перечитування календаря після будь-якої зміни події. Обидва ендпоінти разом,
 * бо та сама подія видна і у вікні сітки, і в курсорному фіді агенди — а фід
 * тепер живе ще й у віджиті дашборда, який про календар нічого не знає.
 */
export function useCalendarRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getCalendarFindWindowQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getCalendarAgendaQueryKey() }),
    ]);
  };
}

export interface EventIntents {
  /** Виконати інтент контекстного меню плитки або рядка агенди */
  applyIntent: (event: CalendarEventResponse, intent: EventIntent) => void;
  /** Перечитати вікно і фід — потрібне і поза інтентами (перетягування) */
  refresh: () => Promise<void>;
  /** Подія, для якої відкрито підтвердження видалення (null — діалог закритий) */
  pendingDelete: CalendarEventResponse | null;
  confirmDelete: () => void;
  closeDelete: () => void;
}

/**
 * Виконавець інтентів контекстного меню події.
 *
 * Меню лишається тим, чим було, — воно ПІДНІМАЄ інтент, а виконує споживач
 * (`event-context-menu.tsx`): дії мутують дані, показують тост, а видалення ще
 * й вимагає підтвердження, і тримати це в кожній із тридцяти плиток означало б
 * тридцять копій одного стану.
 *
 * Але «споживач» — уже не одна сторінка: той самий рядок агенди рендерить і
 * календар, і віджит дашборда. Тому виконавець винесений у хук: логіка мутацій
 * лежить в одному місці, а сторінка лишає собі рівно те, чого хук знати не
 * може — куди відкривати панель події (`onOpen`) і чим заповнювати форму
 * дубліката (`onDuplicate`).
 *
 * Оптимістичного патчу тут свідомо немає: на відміну від перетягування, плитка
 * не рухається під курсором, тож затримка в 200 мс нічого не ламає.
 */
export function useEventIntents({
  onOpen,
  onDuplicate,
}: {
  onOpen: (event: CalendarEventResponse) => void;
  onDuplicate: (draft: EventDraft) => void;
}): EventIntents {
  const { t } = useTranslation('calendar');
  const refresh = useCalendarRefresh();
  const setStatus = useCalendarSetStatus();
  const setRsvp = useCalendarSetRsvp();
  const removeEvent = useCalendarRemove();
  const [pendingDelete, setPendingDelete] = useState<CalendarEventResponse | null>(null);

  /** Спільний хвіст усіх дій: успіх — тост, помилку показує глобальний обробник */
  const runIntent = async (mutation: Promise<unknown>, message: string): Promise<void> => {
    try {
      await mutation;
      toast.add({ type: 'success', title: message });
    } finally {
      await refresh();
    }
  };

  const applyIntent = (event: CalendarEventResponse, intent: EventIntent): void => {
    switch (intent.kind) {
      case 'open':
        onOpen(event);
        return;
      case 'duplicate':
        // Копія відкривається ФОРМОЮ, а не створюється тихо: у дубліката майже
        // завжди міняють час або назву, і зберегти його одним кліком означало б
        // отримати другу однакову зустріч у тому самому слоті
        onDuplicate({
          startsAt: new Date(event.startsAt),
          endsAt: new Date(event.endsAt),
          template: event,
        });
        return;
      case 'delete':
        // Єдина дія, що не виконується одразу: скасування зворотне і лишає
        // історію, а DELETE — ні
        setPendingDelete(event);
        return;
      case 'cancel':
      case 'restore':
        void runIntent(
          setStatus.mutateAsync({
            id: event.id,
            data: { status: intent.kind === 'cancel' ? 'CANCELLED' : 'CONFIRMED' },
          }),
          t(intent.kind === 'cancel' ? 'menu.cancelled' : 'menu.restored'),
        );
        return;
      case 'rsvp':
        void runIntent(
          setRsvp.mutateAsync({ id: event.id, data: { response: intent.response } }),
          t('menu.rsvpSaved'),
        );
        return;
    }
  };

  return {
    applyIntent,
    refresh,
    pendingDelete,
    closeDelete: () => {
      setPendingDelete(null);
    },
    confirmDelete: () => {
      const event = pendingDelete;
      setPendingDelete(null);
      if (event) {
        void runIntent(removeEvent.mutateAsync({ id: event.id }), t('menu.deleted'));
      }
    },
  };
}

/**
 * Підтвердження видалення події. Живе поруч із виконавцем інтентів, а не в
 * кожній плитці: діалог у застосунку один, а не по одному на кожну подію.
 */
export function EventDeleteDialog({ intents }: { intents: EventIntents }) {
  const { t } = useTranslation('calendar');

  return (
    <AlertDialog
      open={intents.pendingDelete !== null}
      onOpenChange={(next) => {
        if (!next) {
          intents.closeDelete();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('menu.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('menu.deleteHint', { title: intents.pendingDelete?.title ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('menu.deleteCancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={intents.confirmDelete}>
            {t('menu.deleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
