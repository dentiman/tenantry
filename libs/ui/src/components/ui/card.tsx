import * as React from 'react';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру: поверхню задають ТРИ незалежні осі, а не класи на
 * місці виклику. Метрики, spacing і композиція частин лишаються стоковими.
 *
 *   fill   скільки поверхні     default | muted | subtle | ghost | opaque | nested
 *   tone   колір                neutral | info | success | warning | danger | accent
 *   border характер лінії       solid | dashed | dotted
 *   edge   акцентна смуга 3px   boolean (колір = tone на повну силу)
 *   radius скруглення кутів     default | sm (радіус контролів) | none
 *
 * Самі значення — `libs/ui/src/card-surface.css` (там і чому заливка
 * напівпрозора, і чому у світлій темі альфа інша). Тут лише data-атрибути:
 * заливка — вкладений `color-mix` із трьох токенів, у Tailwind-класі такий
 * вираз не записати.
 *
 * Чому осі, а не `variant`: різновиди не комбінуються, а ці три ортогональні —
 * «приглушена попереджувальна з пунктиром» це реальний стан, і через
 * `variant` він вимагав би окремого імені на кожну пару.
 */

interface CardSurfaceProps {
  /** Характер контуру. `dashed`/`dotted` — для незавершеного й drop-зон */
  border?: 'solid' | 'dashed' | 'dotted';
  /**
   * Акцентна смуга 3px при лівому краї кольором `tone` на повну силу —
   * патерн плитки календаря: тиха заливка плюс чіткий маркер типу
   */
  edge?: boolean;
  /** Щільність заливки. Усе, крім `default`/`opaque`, без підняття */
  fill?: 'default' | 'muted' | 'subtle' | 'ghost' | 'opaque' | 'nested';
  size?: 'default' | 'sm';
  /** Скруглення кутів. `sm` — той самий радіус, що в кнопок і полів */
  radius?: 'default' | 'sm' | 'none';
  /** Колір поверхні й межі. Джерело — палітра подій, спільна з календарем */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
}

function Card({
  border = 'solid',
  className,
  edge = false,
  fill = 'default',
  radius = 'default',
  size = 'default',
  tone = 'neutral',
  ...props
}: React.ComponentProps<'div'> & CardSurfaceProps) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-fill={fill}
      data-tone={tone}
      data-border={border}
      data-edge={edge || undefined}
      data-radius={radius}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
