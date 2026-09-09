import { useEffect, useRef, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@saas-skeleton/ui/components/ui/calendar';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@saas-skeleton/ui/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@saas-skeleton/ui/components/ui/popover';
import {
  dateInputMask,
  formatDateValue,
  fromDateValue,
  parseDateInput,
  toDateValue,
  type DateValue,
  type DateValueFormat,
} from '@saas-skeleton/ui/lib/date-value';
import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Затримка перед переведенням фокуса в сітку — трохи більша за анімацію появи
 * поповера (`duration-100`), інакше Base UI перебиває фокус своїм.
 */
const FOCUS_GRID_DELAY_MS = 120;

/** Скільки років охоплює випадайка року, коли межі не задані явно */
const YEARS_BACK = 100;
const YEARS_FORWARD = 10;

export interface DatePickerProps {
  id?: string;
  name?: string;
  /** `yyyy-MM-dd` або `null` — цивільна дата без години і зони */
  value: DateValue | null;
  onValueChange: (value: DateValue | null) => void;
  /** Викликається ПІСЛЯ розбору введеного тексту — RHF отримує вже нове значення */
  onBlur?: () => void;
  disabled?: boolean;
  /** Підміняє маску формату (`mm/dd/yyyy`), яка стоїть тут за замовчуванням */
  placeholder?: string;
  /**
   * Як показувати обрану дату. Дефолт — `iso` (`2026-09-09`), стандарт
   * скелетона; перевизначає КОД конкретного екрана, а не юзер у налаштуваннях.
   */
  format?: DateValueFormat;
  min?: DateValue;
  max?: DateValue;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  captionLayout?: 'label' | 'dropdown' | 'dropdown-months' | 'dropdown-years';
  className?: string;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string;
}

/**
 * Поле дати: **ввід із клавіатури + календар у поповері**.
 *
 * Чому не нативний `<input type="date">`, який стоїть у панелі події зараз: він
 * малюється браузером, тобто його вигляд, порядок полів і поповер не належать
 * нашій темі — у вузькій контекстній панелі він уже обрізав значення, а в
 * Safari/Firefox це взагалі три різні контроли. І чому не «кнопка, що відкриває
 * календар» (найпоширеніший приклад із реєстру): дату, яку людина знає, вона
 * набирає швидше, ніж домотує сітку, а зчитувачу екрана звичайне поле дається
 * легше за сітку з 42 кнопок. Календар лишається ДРУГИМ шляхом — для «десь у
 * кінці наступного тижня», яке з голови не набереш.
 *
 * Значення — рядок `yyyy-MM-dd` (див. `lib/date-value.ts`): цивільна дата не
 * має зони, і загортати її в `Date` означає щоразу ловити зсув на сусідню добу.
 *
 * Розкладка — `InputGroup` з addon-кнопкою праворуч, той самий каркас, що в
 * `FormPasswordField`: поле лишається полем, а знак усередині нього.
 */
export function DatePicker({
  id,
  name,
  value,
  onValueChange,
  onBlur,
  disabled,
  placeholder,
  format = 'iso',
  min,
  max,
  weekStartsOn,
  captionLayout = 'dropdown',
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const { t, i18n } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => formatDateValue(value, format));
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState<Date | undefined>(() => fromDateValue(value) ?? undefined);

  /*
   * Значення могло змінитись ЗОВНІ — reset форми, друге поле діапазону, приїзд
   * даних із сервера. Але не поки людина друкує саме в цьому полі: інакше
   * перший же символ переписувався б відформатованим «попереднім» значенням.
   * Мова теж у залежностях — при перемиканні локалі підпис має перемалюватись.
   */
  useEffect(() => {
    if (document.activeElement === inputRef.current) {
      return;
    }
    setText(formatDateValue(value, format));
  }, [value, format, i18n.language]);

  /*
   * Фокус у сітку — руками, і це не дублювання роботи бібліотеки.
   * Календар відкривається ДВОМА шляхами: кліком по знаку (тригер) і стрілкою
   * вниз із поля. Другий для Base UI — програмна зміна `open`, тобто відкриття
   * «без взаємодії»: ні його `initialFocus`, ні `autoFocus` react-day-picker
   * у цьому випадку фокус не переносять (перевірено в браузері: після
   * ArrowDown поповер відкритий, а `document.activeElement` — усе ще поле), і
   * клавіатурник отримував сітку, якою не може керувати. Ціль — обраний день,
   * а не перший у місяці: далі стрілки ходять від нього.
   *
   * Гвард `popup.contains(activeElement)` лишає роботу бібліотеці там, де вона
   * її робить сама (відкриття кліком), — ми лише добираємо випадок, який вона
   * пропускає.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // setTimeout, а не rAF: ранній виклик Base UI перебиває власною розстановкою
    // фокуса, яка відбувається не в тому ж кадрі, у якому монтується попап
    const timer = setTimeout(() => {
      const popup = popupRef.current;
      if (!popup || popup.contains(document.activeElement)) {
        return;
      }
      const day =
        popup.querySelector<HTMLElement>('[data-day][data-selected-single="true"]') ??
        popup.querySelector<HTMLElement>('[data-day][tabindex="0"]') ??
        popup.querySelector<HTMLElement>('[data-day]:not([disabled]):not([data-outside])');
      day?.focus();
    }, FOCUS_GRID_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  const selected = fromDateValue(value) ?? undefined;
  const minDate = fromDateValue(min ?? null);
  const maxDate = fromDateValue(max ?? null);

  /*
   * Межі навігації. Без явного `endMonth` react-day-picker обмежує випадайку
   * року КІНЦЕМ ПОТОЧНОГО РОКУ (`getNavMonths`) — тобто в грудні дату на
   * січень уже не вибрати. Тому діапазон задається завжди, а не «якщо є
   * min/max».
   */
  const navStart = minDate ?? new Date(new Date().getFullYear() - YEARS_BACK, 0, 1);
  const navEnd = maxDate ?? new Date(new Date().getFullYear() + YEARS_FORWARD, 11, 31);

  /** Текст → значення. Нерозпізнане повертає поле до останнього валідного стану */
  const commit = (): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (value !== null) {
        onValueChange(null);
      }
      setText('');
      return;
    }
    const parsed = parseDateInput(trimmed);
    if (parsed === null) {
      /*
       * Мовчазний відкат, а не власна помилка під полем. Другий канал помилок
       * поруч зі схемою розійшовся б із нею вже на другому полі («дата в
       * минулому» знає схема, «це не дата» знав би компонент), а показувати
       * людині «14/45/2026» як прийняте значення — гірше за обидва варіанти.
       * Так само поводяться Google Calendar і Notion.
       */
      setText(formatDateValue(value, format));
      return;
    }
    if (parsed !== value) {
      onValueChange(parsed);
    }
    setText(formatDateValue(parsed, format));
  };

  return (
    <InputGroup className={cn(className)}>
      <InputGroupInput
        id={id}
        name={name}
        ref={inputRef}
        value={text}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? dateInputMask(format, i18n.language)}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          commit();
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
          }
          // Стрілка вниз відкриває календар — патерн WAI-ARIA для date-поля
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            return;
          }
          if (event.key === 'Enter') {
            // Без preventDefault: розібрали ввід і пустили submit форми далі
            commit();
          }
        }}
      />
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            // Календар відкривається на місяці ОБРАНОЇ дати, а не там, де його
            // закрили минулого разу
            setMonth(fromDateValue(value) ?? new Date());
          }
          setIsOpen(open);
        }}
      >
        <InputGroupAddon align="inline-end">
          <PopoverTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                disabled={disabled}
                aria-label={t('datePicker.open')}
              >
                <CalendarIcon />
              </InputGroupButton>
            }
          />
        </InputGroupAddon>
        {/* Фокус після закриття вертається В ПОЛЕ, а не на кнопку-знак: далі
            людина або друкує, або йде табом на наступне поле форми */}
        <PopoverContent
          ref={popupRef}
          className="w-auto p-0"
          align="end"
          alignOffset={-8}
          sideOffset={8}
          finalFocus={inputRef}
        >
          <Calendar
            mode="single"
            autoFocus
            captionLayout={captionLayout}
            weekStartsOn={weekStartsOn}
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            startMonth={navStart}
            endMonth={navEnd}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            onSelect={(day: Date | undefined) => {
              if (!day) {
                return;
              }
              const next = toDateValue(day);
              onValueChange(next);
              setText(formatDateValue(next, format));
              setIsOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </InputGroup>
  );
}
