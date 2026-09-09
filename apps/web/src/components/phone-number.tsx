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
 * - **Колір `muted-foreground`**: телефон — довідкове поле поруч з іменем, а не
 *   те, що читають першим; на щабель тихіше за основний текст рядка.
 * - **Копіюється тільки клік по самому номеру**: окремої кнопки-іконки поруч
 *   немає — у гріді вона зайняла б стільки ж місця, скільки саме значення, і
 *   зʼявлялась би в кожному рядку.
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
        'tabular-nums text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      {display}
    </CopyToClipboard>
  );
}
