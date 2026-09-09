'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Область прокрутки з ОВЕРЛЕЙНОЮ смугою: невидима в спокої, зʼявляється на
 * прокрутку або наведення і повільно згасає, коли те й те скінчилось.
 *
 * ── Звідки поведінка ──────────────────────────────────────────────────────────
 * Еталон — список чатів Telegram Web. Його CSS (знято з живої сторінки
 * 2026-09-09) виглядає так:
 *
 * ```css
 * .custom-scroll { scrollbar-color: transparent transparent; scrollbar-width: thin;
 *                  transition: scrollbar-color .3s; }
 * .custom-scroll:hover, .custom-scroll:focus-within { scrollbar-color: var(--color-scrollbar) transparent; }
 * .chat-list { overflow: hidden scroll; padding-inline-end: max(.5rem - var(--scrollbar-width), 0px); }
 * ```
 *
 * Тобто вони фарбують НАТИВНУ смугу в прозорий і повертають колір на hover. Ми
 * цей рецепт НЕ копіюємо, і ось чому:
 *
 * 1. **Він не дає справжнього оверлея.** `overflow: scroll` резервує місце
 *    завжди, а «накладання» імітується відʼємним падінгом
 *    (`max(.5rem - var(--scrollbar-width), 0px)`) — тобто ширину все одно
 *    відібрано, просто в іншого відступу.
 * 2. **Плавність там половинчаста.** `transition: scrollbar-color` анімується у
 *    Firefox, а в Chrome псевдоелементи `::-webkit-scrollbar-*` переходів не
 *    підтримують — там перемикання миттєве в обидва боки.
 * 3. **Тригер тільки `:hover`.** «Показати під час прокрутки» нативна смуга не
 *    вміє взагалі — про прокрутку CSS не знає.
 *
 * Base UI ховає нативну смугу (`overflow: scroll` + внутрішній клас, що глушить
 * `::-webkit-scrollbar`) і рендерить СВОЮ звичайним `div`. Звідси все, чого
 * рецепту Telegram бракує: смуга позиціюється `absolute` — отже справді лежить
 * ПОВЕРХ вмісту і ширини не забирає; `opacity` анімується в усіх браузерах; а
 * `data-scrolling` / `data-hovering` дають обидва тригери замість одного.
 *
 * ── Асиметрія появи і згасання ────────────────────────────────────────────────
 * Зʼявляється смуга майже миттєво (75–100 мс), згасає повільно (500 мс). Це не
 * смак: поява — це відповідь на дію людини, і затримка в ній читається як
 * гальмування інтерфейсу; згасання ж дії не супроводжує, і різке зникнення
 * читається як блимання.
 *
 * Технічно асиметрію дає те, що `transition-duration` береться зі стану, В ЯКИЙ
 * елемент переходить: у станових класах вона коротка, у базовому — довга. Плюс
 * сам Base UI тримає `data-scrolling` ще 500 мс після зупинки (його
 * `SCROLL_TIMEOUT`), тож повний хвіст після прокрутки — близько секунди.
 *
 * ── Вісь: `vertical` за замовчуванням ─────────────────────────────────────────
 * Viewport Base UI отримує `overflow: scroll` по ОБИДВОХ осях, і навіть без
 * видимої смуги вміст лишається зсувним убік трекпадом. У вузьких поверхнях
 * (контекстна панель) це чистий баг: там горизонтального скролу не буває за
 * визначенням, а зайві пікселі приходять не з розкладки, а з примітивів —
 * прихований нативний `<input>` усередині `Switch` дає `scrollWidth` на 11px
 * більший за `clientWidth` (`ui-known-issues.md` UI-2).
 *
 * Тому дефолт — `axis="vertical"`: горизонтальна вісь глушиться на самому
 * viewport, і жодному споживачеві не треба памʼятати про `overflow-x-hidden`.
 * `axis="both"` вмикає горизонталь і другу смугу — для справді широкого вмісту.
 *
 * ── `Content` обовʼязковий ────────────────────────────────────────────────────
 * Вміст обгорнутий у `ScrollAreaPrimitive.Content` — частину, якої немає в
 * реєстровому shadcn-варіанті, і саме через це там живе тихий баг. Base UI
 * перераховує переповнення на прокрутку і на resize VIEWPORT-а; коли вміст
 * змінює висоту, а viewport лишається того самого розміру (перехід між роутами
 * всередині шела — рівно цей випадок), перерахунку не відбувається. Симптом:
 * пішов з високої сторінки юзера на короткий грід — смуга лишилась висіти,
 * хоча скролити нічого; зайшов на грід одразу — смуги немає.
 *
 * `Content` вішає на обгортку `ResizeObserver` і кличе `computeThumbPosition()`,
 * тобто закриває саме той канал, якого бракувало. Класи вмісту йдуть у
 * `contentClassName` (не в `viewportClassName`): flex-контейнером для елементів
 * має бути їхній ПРЯМИЙ предок, а це тепер `Content`.
 *
 * ── Висота: flex, а не відсотки ───────────────────────────────────────────────
 * Корінь — `flex flex-col`, viewport — `min-h-0 flex-1`. Ні `h-full`, ні
 * `absolute inset-0`, і обидва були спробувані й відкинуті на стенді
 * `/playground/dialog`:
 *
 * - **`h-full` (реєстровий `size-full`)** мовчки перетворюється на `height: auto`,
 *   коли предок обмежений `max-height`, а не `height`: відсоткова висота
 *   розвʼязується проти SPECIFIED висоти предка, і ланцюг `flex-1` передає вниз
 *   РОЗМІР, але не його визначеність. Симптом у діалозі: viewport виріс на всю
 *   висоту вмісту (1953px замість 602), скрол не ввімкнувся, Base UI не побачив
 *   переповнення і не змонтував смугу, а `overflow-hidden` кореня просто
 *   ВІДРІЗАВ половину форми. У сітках і панелі того ж дня це не проявлялось —
 *   там ланцюг починається з `h-svh`, тобто визначеність є.
 * - **`absolute inset-0`** ламає протилежний бік: корінь лишається без вмісту в
 *   потоці, `flex-1` у контейнері з `max-height` дає йому нуль, і діалог
 *   схлопується до хедера з футером.
 *
 * Flex не має ні тієї, ні іншої проблеми: корінь отримує used height ззовні, а
 * далі РОЗПОДІЛЯЄ її своїм items — визначеність specified-висоти тут не потрібна
 * взагалі. Це той самий `min-h-0 flex-1`, яким у проєкті вже написані всі
 * скролери форм.
 *
 * ── `pointer-events` ──────────────────────────────────────────────────────────
 * Невидима смуга НЕ ловить вказівник: вона лежить поверх вмісту біля правого
 * краю, і без цього останні 8px кожного рядка (у календарі — остання колонка
 * дня) мовчки перестали б клікатись. Щойно смуга видима — вона знову звичайний
 * елемент, який можна схопити й потягнути.
 */
function ScrollArea({
  className,
  children,
  axis = 'vertical',
  size = 'default',
  viewportRef,
  contentClassName,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  /**
   * Товщина смуги. `default` (8px) — для панелей і сіток усередині сторінки;
   * `lg` (10px) — для ГОЛОВНОГО скролу сторінки: він один на екран, ним
   * користуються найчастіше, і в нього немає сусіда, з яким треба збігтися за
   * розміром. Це та сама логіка, що робить смугу вікна товщою за смугу
   * випадайки в будь-якій ОС.
   *
   * Різниця між рівнями свідомо МАЛА — один крок шкали (2px). Спочатку `lg`
   * було 12px, і на живому екрані смуга читалась як елемент інтерфейсу, а не як
   * службовий індикатор: оверлейна смуга лежить ПОВЕРХ вмісту, тож кожен зайвий
   * піксель вона забирає не в розкладки, а в уваги.
   */
  size?: 'default' | 'lg';
  /**
   * Які осі скроляться. `vertical` (дефолт) глушить горизонталь на viewport —
   * див. розділ «Вісь» вище.
   */
  axis?: 'vertical' | 'both';
  /**
   * Доступ до елемента, що реально скролиться. Потрібен там, де прокруткою
   * керує код: `scrollTo` на «зараз» у сітці дня, автоскрол під час
   * перетягування події.
   */
  viewportRef?: React.Ref<HTMLDivElement>;
  /**
   * Класи на обгортці вмісту — коли він мусить бути flex-контейнером або
   * розтягуватись на висоту viewport (`min-h-full`).
   */
  contentClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative flex flex-col overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="min-h-0 flex-1 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        // Інлайном, а не класом: Base UI ставить `overflow: scroll` теж інлайном,
        // і клас його не перебʼє
        style={axis === 'vertical' ? { overflowX: 'hidden', overflowY: 'scroll' } : undefined}
      >
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content" className={contentClassName}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar size={size} />
      {axis === 'both' && <ScrollBar orientation="horizontal" size={size} />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  size = 'default',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props & { size?: 'default' | 'lg' }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        // Оверлей: смуга лежить ПОВЕРХ вмісту і ширини не забирає
        'absolute z-20 flex touch-none p-px select-none',
        'data-vertical:top-0 data-vertical:right-0 data-vertical:h-full',
        'data-horizontal:bottom-0 data-horizontal:left-0 data-horizontal:w-full data-horizontal:flex-col',
        size === 'lg'
          ? 'data-vertical:w-2.5 data-horizontal:h-2.5'
          : 'data-vertical:w-2 data-horizontal:h-2',
        // Стан спокою: невидима і прозора для вказівника
        'pointer-events-none opacity-0 transition-opacity duration-500 ease-out',
        // Прокрутка і наведення показують її; тривалість тут коротка, тому
        // поява швидка, а повернення в базовий клас (згасання) — повільне
        'data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-75',
        'data-hovering:pointer-events-auto data-hovering:opacity-100 data-hovering:duration-100',
        className,
      )}
      {...props}
    >
      {/* ЛОКАЛЬНА ПРАВКА реєстру: повзунок бере `--icon-muted`, а не `--border`.
          Межа в темній темі напівпрозора (5.5% білого) — на ній повзунок був би
          невидимий; він же не розділювач, а керований елемент. */}
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-icon-muted"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
