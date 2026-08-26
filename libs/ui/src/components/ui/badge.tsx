import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@saas-skeleton/ui/lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/60 dark:aria-invalid:ring-destructive/60 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground [a]:hover:bg-[color-mix(in_oklab,var(--primary)_90%,black_10%)] dark:[a]:hover:bg-[color-mix(in_oklab,var(--primary)_90%,white_10%)]',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive focus-visible:ring-destructive/60 dark:bg-destructive/[8%] dark:focus-visible:ring-destructive/60 [a]:hover:underline',
        // ЛОКАЛЬНА ПРАВКА реєстру (docs/frontend/ui-stack.md §6): у shadcn немає
        // success/warning, а 6 станів
        // job-а і статус тенанта інакше не передати. Форма — та сама «м'яка» заливка, що в
        // destructive, тому в `shadcn diff badge` цей блок читається як локальна вставка
        success:
          'bg-success/10 text-success focus-visible:ring-success/20 dark:bg-success/10 dark:focus-visible:ring-success/40 [a]:hover:underline',
        warning:
          'bg-warning/10 text-warning focus-visible:ring-warning/20 dark:bg-warning/10 dark:focus-visible:ring-warning/40 [a]:hover:underline',
        outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  });
}

export { Badge, badgeVariants };
