import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру. Відмінності від стокового base-nova:
 *   1. `destructive` — СУЦІЛЬНИЙ HeroUI danger (`bg-destructive
 *      text-destructive-foreground`), а не мʼяка заливка `bg-destructive/10`.
 *   2. Primary/destructive та їхній hover ідуть через точні семантичні токени
 *      HeroUI v3, без ручних light/dark кольорів у рецепті.
 *   3. Метрика: `default` 36px (`sm` 32, `xs` 28, `lg` 40) — свідоме відхилення
 *      від стоку; поля вирівняні по тій самій висоті.
 *   4. `radius="full"` — opt-in pill для текстових кнопок і коло для icon-only;
 *      звичайний radius лишається дефолтом і не ламає наявні виклики.
 *   5. `xl` (48px, `text-base`, іконка 20px) — єдиний «великий» розмір: головний заклик
 *      вітринної сторінки (кнопка входу під публічним путівником). Це не метрика форм —
 *      у формах і таблицях він не вживається; додано, щоб велику кнопку давав примітив,
 *      а не `h-*` на місці виклику.
 * Фокус — суцільне `ring-2` кольору `--ring` (наш синій) з відступом 2px.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/60 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        outline:
          "border-border bg-background hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground dark:border-input dark:bg-input/30 [&_svg:not([class*='text-'])]:text-icon hover:[&_svg:not([class*='text-'])]:text-icon-strong",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground [&_svg:not([class*='text-'])]:text-icon hover:[&_svg:not([class*='text-'])]:text-icon-strong",
        ghost:
          "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg:not([class*='text-'])]:text-icon hover:[&_svg:not([class*='text-'])]:text-icon-strong",
        toolbar:
          "text-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg:not([class*='text-'])]:text-icon hover:[&_svg:not([class*='text-'])]:text-icon-strong",
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover focus-visible:border-destructive/40 focus-visible:ring-destructive/60 dark:focus-visible:ring-destructive/60',
        /**
         * «Піднята» кнопка — той самий матеріал, що активний сегмент табів
         * (`--segment`): у світлій темі біла з обводкою й тінню, у темній
         * ІНВЕРТОВАНА в майже білу з темним написом. Патерн Notion: у темряві
         * «на сходинку світліший сірий» читається тьмяним, а не піднятим, тож
         * підняття там передається протилежним ходом. Іконки тут свідомо БЕЗ
         * `text-icon`: на світлій плитці в темній темі знак мусить бути
         * темним, а `--icon` — світлий.
         */
        elevated:
          'border-border bg-segment text-segment-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--segment),var(--segment-foreground)_8%)] aria-expanded:bg-[color-mix(in_oklab,var(--segment),var(--segment-foreground)_8%)]',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-md px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xl: "h-12 gap-2.5 px-8 text-base has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6 [&_svg:not([class*='size-'])]:size-5",
        icon: 'size-9',
        'icon-xs':
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-md in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-10',
      },
      radius: {
        default: '',
        full: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      radius: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  radius = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, radius, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
