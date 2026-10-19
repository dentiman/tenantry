import { Phone } from 'lucide-react';
import { CopyToClipboard } from '@saas-skeleton/ui/components/copy-to-clipboard';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { formatForDisplay, toDialableDigits } from './form/phone/phone-format';

interface PhoneNumberProps {
  /** E.164 з API; null/порожній — рендериться прочерк */
  value?: string | null;
  /** Класи поверх дефолтних (колір/типографіка тут уже задані) */
  className?: string;
}

/**
 * Телефон у режимі читання: приглушений клікабельний номер, який копіюється.
 *
 * Один компонент на всі поверхні (грід юзерів, грід кастомерів, обидві картки) —
 * інакше «як саме показувати телефон» вирішувалося б окремо в кожній із них, і
 * вони вже почали розходитись: у гріді номер стояв із прапором, у картці — теж,
 * а в підзаголовку ідентичності кастомера без нього.
 *
 * Рішення:
 * - **Без прапора** (рішення користувача): код країни вже є в самому номері, а
 *   прапор у колонці читався як окремий смисловий стовпчик — око чіплялось за
 *   нього замість цифр. `phoneCountry` лишається в моделі — він потрібен формі
 *   редагування (за `+1` країну не відновити), а не показу.
 * - **Дрібніший кегль (`text-xs`) і дефіси**: телефон — довідкове поле поруч з
 *   іменем, а не те, що читають першим; цифри через дефіс групуються оком.
 * - **Синій відтінок бренду (`primary`, підмішаний до тексту)**: як у сервісних
 *   систем (Zendesk, HubSpot) — телефон/email «дієві» значення, їх впізнають за
 *   кольором. Підмішування `foreground` не дає світлому синьому провалити
 *   контраст на 12px.
 * - **Ледь помітна іконка телефону попереду** (`icon-muted`): маркує тип значення
 *   без підпису колонки; на ховері яснішає разом з номером. Це НЕ кнопка —
 *   копіюється клік по всьому елементу.
 * - **Копіюються суцільні цифри** (`toDialableDigits`): без дефісів, пробілів і плюса.
 */
export function PhoneNumber({ value, className }: PhoneNumberProps) {
  const display = formatForDisplay(value);
  const digits = toDialableDigits(value);

  if (!display || !digits) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <CopyToClipboard
      value={digits}
      className={cn(
        'group/phone gap-1.5 text-xs tabular-nums text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))] transition-colors hover:text-primary',
        className,
      )}
    >
      <Phone aria-hidden className="size-3 shrink-0 text-icon-muted transition-colors group-hover/phone:text-primary" />
      <span className="truncate">{display}</span>
    </CopyToClipboard>
  );
}
