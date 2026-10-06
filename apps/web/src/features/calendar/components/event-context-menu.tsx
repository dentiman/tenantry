import { useTranslation } from 'react-i18next';
import { CalendarOffIcon, CopyIcon, ExternalLinkIcon, RotateCcwIcon, TrashIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@saas-skeleton/ui/components/ui/context-menu';

/**
 * Контекстне меню події (CAL-2, правий клік на плитці).
 *
 * **Меню не виконує нічого саме** — воно піднімає ІНТЕНТ угору, а виконує
 * сторінка. Причина не в чистоті шарів: дії тут мутують дані і мусять показувати
 * тост, відкат і підтвердження видалення, а плитка живе в сітці по 30 штук на
 * екран. Тримати в кожній свій `AlertDialog` і свій набір мутацій означало б
 * 30 копій одного стану; сторінка вже володіє і мутаціями (перетягування), і
 * панеллю події.
 *
 * Склад свідомо короткий: правий клік — це прискорювач для того, що людина вже
 * знає, а не другий редактор. Усе, чого тут немає, лежить у панелі.
 */

export type EventIntent =
  | { kind: 'open' }
  | { kind: 'duplicate' }
  | { kind: 'cancel' }
  | { kind: 'restore' }
  | { kind: 'delete' }
  | { kind: 'rsvp'; response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' };

type RsvpResponse = Extract<EventIntent, { kind: 'rsvp' }>['response'];

const RSVP_OPTIONS: RsvpResponse[] = ['ACCEPTED', 'TENTATIVE', 'DECLINED'];

export function EventContextMenu({
  event,
  trigger,
  onIntent,
}: {
  event: CalendarEventResponse;
  /** Плитка; віддається тригеру через `render`, тому це саме елемент */
  trigger: React.ReactElement;
  onIntent: (event: CalendarEventResponse, intent: EventIntent) => void;
}) {
  const { t } = useTranslation('calendar');
  const isCancelled = event.status === 'CANCELLED';

  return (
    <ContextMenu>
      <ContextMenuTrigger render={trigger} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          onClick={() => {
            onIntent(event, { kind: 'open' });
          }}
        >
          <ExternalLinkIcon />
          {t('menu.open')}
        </ContextMenuItem>

        {/* RSVP лише учаснику: організатор без рядка участі відповідати нікому
            не мусить, і порожня трійка кнопок його б лише плутала */}
        {event.myResponse && (
          <>
            <ContextMenuSeparator />
            {/* `ContextMenuLabel` — це `GroupLabel` Base UI: без `Group` навколо
                він падає в РАНТАЙМІ (правило 12 у CLAUDE.md) */}
            <ContextMenuGroup>
              <ContextMenuLabel>{t('rsvp.question')}</ContextMenuLabel>
            </ContextMenuGroup>
            {/* Radio, а не три звичайні пункти: поточна відповідь мусить бути
                видна — саме по неї сюди й заходять найчастіше */}
            <ContextMenuRadioGroup
              value={event.myResponse}
              onValueChange={(next) => {
                onIntent(event, { kind: 'rsvp', response: next as RsvpResponse });
              }}
            >
              {RSVP_OPTIONS.map((response) => (
                <ContextMenuRadioItem key={response} value={response}>
                  {t(`rsvp.${response}`)}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </>
        )}

        <ContextMenuSeparator />
        {/* Копіювати можна те, що видно: створюється МОЯ нова подія, і права на
            оригінал тут ні до чого */}
        <ContextMenuItem
          onClick={() => {
            onIntent(event, { kind: 'duplicate' });
          }}
        >
          <CopyIcon />
          {t('menu.duplicate')}
        </ContextMenuItem>

        {event.canEdit && (
          <ContextMenuItem
            onClick={() => {
              onIntent(event, { kind: isCancelled ? 'restore' : 'cancel' });
            }}
          >
            {isCancelled ? <RotateCcwIcon /> : <CalendarOffIcon />}
            {t(isCancelled ? 'form.restoreEvent' : 'form.cancelEvent')}
          </ContextMenuItem>
        )}

        {event.canEdit && (
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              onIntent(event, { kind: 'delete' });
            }}
          >
            <TrashIcon />
            {t('form.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
