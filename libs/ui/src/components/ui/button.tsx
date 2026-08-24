import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру (2026-08-24, вирівнювання під HeroUI).
 * Три відмінності від стокового base-nova, усі — навмисні:
 *   1. `rounded-full` замість `rounded-lg`: у HeroUI кнопка це `rounded-3xl`
 *      при висоті 40px, тобто пігулка. Наші кнопки нижчі, тож пігулку дає `full`.
 *   2. `destructive` — СУЦІЛЬНИЙ червоний (`.button--danger` у HeroUI), а не
 *      мʼяка заливка `bg-destructive/10`. У base-nova немає
 *      `--destructive-foreground`, тому текст білий явно (їхній danger-foreground
 *      = snow, тобто теж майже білий).
 *   3. Натиск — `scale`, як у HeroUI (`transform: scale(0.97)`), а не зсув на 1px.
 *   4. Фокус — суцільне 2px-кільце з відступом 2px (їхній `focus-ring`), а не
 *      напівпрозорі 3px; висоти підняті на крок до десктопної шкали HeroUI
 *      (`default` = 36px, як їхня `md:h-9`), поля вирівняні по тій самій висоті.
 * Hover заливок рахується через `color-mix` із foreground (їхній `*-hover`), а не
 * прозорістю: на сірому фоні прозорість вимивала б колір.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/60 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_90%,var(--primary-foreground)_10%)]',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive text-white hover:bg-[color-mix(in_oklab,var(--destructive)_90%,white_10%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/60 dark:focus-visible:ring-destructive/60',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        xs: "h-7 gap-1 px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-9',
        'icon-xs':
          "size-7 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
