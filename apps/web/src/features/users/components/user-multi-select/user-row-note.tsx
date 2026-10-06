import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@saas-skeleton/ui/components/ui/popover';

interface UserRowNoteProps {
  /** Що це за примітка: заголовок попапа і `aria-label` крапки («Comment») */
  label: string;
  /** Вміст попапа. Рядок, короткий фрагмент — не блок і не форма */
  children: ReactNode;
  /** Знак у крапці. За замовчуванням — «i»; коментар доречніше позначити реплікою */
  icon?: ReactNode;
}

/**
 * Примітка до рядка `UserMultiList` — **бейдж, який утратив текст**.
 *
 * Саме бейдж, а не власна кнопка: висота 20px, м'яка поверхня і місце в правому
 * кластері рядка в неї ті самі, що в сусіднього RSVP-бейджа, тож два елементи
 * читаються як одна група, а не як «статус і ще якийсь контрол». Різниця рівно
 * одна — коло замість пігулки, бо в ній не текст, а знак.
 *
 * Навіщо взагалі: рядок списку фіксований у 48px, і другий рядок тексту під
 * іменем (як було в `AttendeePicker`) ламає і висоту, і крок перетягування.
 * Усе, що не вміщається, ховається за крапку і показується попапом.
 *
 * Чому `Popover`, а не `Tooltip`: тултіп відкривається лише наведенням, тобто на
 * тачі його не існує. `PopoverTrigger` з `openOnHover` дає всі три входи —
 * наведення на десктопі, тап на тачі, Enter із клавіатури, — і при цьому вміст
 * лишається виділюваним, чого від тултіпа очікувати не можна.
 *
 * Не в `libs/ui`, бо поки що це частина словника ОДНОГО компонента. Другий
 * споживач і буде приводом переїхати.
 */
export function UserRowNote({ label, children, icon }: UserRowNoteProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        openOnHover
        // Затримка на відкриття, але майже жодної на закриття: крапка стоїть за
        // 4px від хрестика, і попап, що вискакує від проходу курсора до нього,
        // дратував би сильніше, ніж допомагав
        delay={200}
        closeDelay={80}
        // Бейдж рендериться `<span>`, а `PopoverTrigger` за замовчуванням
        // очікує НАТИВНУ кнопку (`nativeButton`) — інакше Base UI лається в
        // консоль і крапка втрачає семантику кнопки. Тому вкладений `render`:
        // тригер → бейдж → справжній `<button>`. `type="button"` обов'язковий:
        // крапка живе всередині `<form>` (панель події), і кнопка без типу
        // сабмітила б форму натисканням на примітку
        render={<Badge variant="secondary" render={<button type="button" />} />}
        // `px-0`, а не `p-0`: у бейджі стоїть `px-2`, і Tailwind сортує `p`
        // ПЕРЕД `px` — голий `p-0` програв би за порядком у стилях.
        // `rounded-full` явно, хоч бейджеві `rounded-4xl` (26px) на боці 20px і
        // так дає коло: коло тут — сенс, а не наслідок числа
        className="size-5 cursor-default rounded-full px-0 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        {icon ?? <InfoIcon />}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto max-w-64 gap-1">
        <PopoverTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </PopoverTitle>
        {/* `render={<div/>}` замість стокового `<p>`: слот приймає довільний
            вміст, а абзац усередині абзацу React виправляє лайкою в консоль */}
        <PopoverDescription render={<div />} className="text-sm text-foreground">
          {children}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
