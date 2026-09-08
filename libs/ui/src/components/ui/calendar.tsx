import * as React from "react"
import { cn } from "@saas-skeleton/ui/lib/utils"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { Button, buttonVariants } from "@saas-skeleton/ui/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        // ЛОКАЛЬНА ПРАВКА реєстру: знято `bg-background` з кореня — сітка
        // ПРОЗОРА і бере поверхню того, хто її вставив. Реєстр малює власний фон,
        // а потім гасить його двома винятками (`in-data-[slot=card-content]`,
        // `in-data-[slot=popover-content]`) — тобто перелічує місця, де компонент
        // усе одно не має власної поверхні. Список неповний: у нас календар живе
        // ще й у колонці шела на `bg-sidebar`, де світлий `--background` читався
        // як біла пляма, а в темній темі — як чужий тон. Разом із фоном пішли й
        // обидва гасіння: без нього вони мертвий код.
        "group/calendar p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)]",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          // ЛОКАЛЬНА ПРАВКА реєстру: метрика підпису знята з Notion Calendar —
          // 10px/500 і колір рівня 600 шкали (`--icon`, у них той самий рівень
          // обслуговує і `--text-body`, і знаки). Реєстрові 0.8rem/400 у
          // `muted-foreground` читались як другий ряд ДАНИХ поруч із числами,
          // а це підпис колонки
          "flex-1 rounded-(--cell-radius) text-[10px] font-medium text-icon select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          // ЛОКАЛЬНА ПРАВКА реєстру: `aspect-square` знято — клітинка ширша за
          // висоту (у Notion 32×28), бо смуга «відкритий тиждень» малюється
          // саме на клітинці й мусить змикатись із сусідніми без розривів
          "group/day relative h-(--cell-size) w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted",
          defaultClassNames.range_end
        ),
        today: cn(
          // ЛОКАЛЬНА ПРАВКА реєстру: заливки НЕМАЄ. Реєстровий `bg-muted` —
          // суцільний фон НА КЛІТИНЦІ, тобто на тому самому шарі, що й смуга
          // відкритого тижня: сьогоднішній день вирізав у смузі дірку свого
          // кольору. Заливка в цьому календарі належить ВИБОРУ (`primary`), а
          // «сьогодні» лишається кольором цифри — воно доповнює вибір, а не
          // конкурує з ним
          "font-medium text-primary data-[selected=true]:text-primary-foreground",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon className={cn("size-4", className)} {...props} />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // ЛОКАЛЬНА ПРАВКА реєстру: обведення дня прибрано з `data-focused` і
        // лишилось лише на `focus-visible`. `react-day-picker` тримає
        // «сфокусований день» СВОЇМ станом і сам викликає `focus()` (див.
        // `useEffect` вище), тому реєстрові класи `group-data-[focused=true]`
        // малювали кільце після кліку мишею — і воно лишалось висіти, ще й
        // переїжджало на інший день під час навігації. Індикатор для КЛАВІАТУРИ
        // при цьому зберігся: `:focus-visible` браузер ставить лише тоді, коли
        // фокус приїхав не від мишки
        // ЛОКАЛЬНА ПРАВКА реєстру №2: заливка дня переїхала з САМОЇ кнопки на
        // псевдоелемент `before:` з інсетом. Конструкція скопійована з Notion
        // Calendar (він теж на react-day-picker): клітинка клікається на всю
        // ширину — інакше в сітці лишались би мертві щілини між днями, — але
        // фарбується вужчий бейдж усередині неї. Це те, що робить смугу
        // відкритого тижня і позначку дня двома РІЗНИМИ шарами: смуга йде
        // краями клітинок і змикається, бейдж стоїть усередині неї з відступом.
        // Метрика їхня: клітинка 32×28, бейдж ≈27×23, радіус 6px.
        "relative isolate z-10 flex size-auto h-(--cell-size) w-full min-w-(--cell-size) flex-col gap-1 border-0 text-[13px] leading-none font-normal before:absolute before:inset-x-[3px] before:inset-y-[2px] before:-z-10 before:rounded-sm before:transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring hover:bg-transparent hover:before:bg-accent data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-transparent data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:before:bg-primary [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
