import type { CalendarEventResponse } from '@saas-skeleton/contracts';

type EventKind = CalendarEventResponse['kind'];

/**
 * Як фарбується подія (docs/calendar.md §11.9). Анатомія — з Notion Calendar:
 * світла заливка + **вертикальна смужка 3px ліворуч** + текст того ж
 * кольорового сімейства. Ні рамки навколо, ні насиченого фону: у тижні буває
 * тридцять плиток на екран, і кожна обведена рамка перетворює сітку на сітку
 * рамок.
 *
 * Колір несе ТИП події (`kind`), а не персональний вибір: інакше в тенанті за
 * пів року буде 40 подій вісьмома відтінками без жодної системи (§5.1).
 * Мапінг «тип → іменований колір» живе саме тут, а не в токенах: токени знають
 * лише про кольори (`--event-blue`), домен — лише про типи.
 */
export interface EventKindStyle {
  /** Заливка плитки — НЕПРОЗОРА, тому окремої підкладки під нею не потрібно */
  bg: string;
  /** Наведення СВІТЛІШИТЬ заливку (крізь неї проступає колонка), як у Notion */
  bgHover: string;
  /** Вертикальна смужка як окремий елемент — у сітці */
  line: string;
  /** Та сама смужка як ліва межа рядка — в агенді */
  borderLine: string;
  /** Текст на заливці */
  text: string;
}

export const KIND_STYLES: Record<EventKind, EventKindStyle> = {
  MEETING: {
    bg: 'bg-event-blue-bg',
    bgHover: 'hover:bg-event-blue-bg/70',
    line: 'bg-event-blue-line',
    borderLine: 'border-l-event-blue-line',
    text: 'text-event-blue',
  },
  CALL: {
    bg: 'bg-event-green-bg',
    bgHover: 'hover:bg-event-green-bg/70',
    line: 'bg-event-green-line',
    borderLine: 'border-l-event-green-line',
    text: 'text-event-green',
  },
  DEADLINE: {
    bg: 'bg-event-red-bg',
    bgHover: 'hover:bg-event-red-bg/70',
    line: 'bg-event-red-line',
    borderLine: 'border-l-event-red-line',
    text: 'text-event-red',
  },
  OUT_OF_OFFICE: {
    bg: 'bg-event-orange-bg',
    bgHover: 'hover:bg-event-orange-bg/70',
    line: 'bg-event-orange-line',
    borderLine: 'border-l-event-orange-line',
    text: 'text-event-orange',
  },
  /**
   * «Інше» — свідомо БЕЗ власного кольору: п'ятий іменований відтінок нічого не
   * розрізняв би («інше» і є відсутність типу), а сірий Notion (тепла нейтраль)
   * поруч зі slate-шкалою читався б як бруд. Тому — наші ж нейтральні токени.
   */
  OTHER: {
    bg: 'bg-muted',
    bgHover: 'hover:bg-muted/70',
    line: 'bg-muted-foreground/40',
    borderLine: 'border-l-muted-foreground/40',
    text: 'text-muted-foreground',
  },
};

/** Товщина смужки типу — однакова в сітці й в агенді */
export const KIND_LINE_WIDTH = 'w-[3px]';
