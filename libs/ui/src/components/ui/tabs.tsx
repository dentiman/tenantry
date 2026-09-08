import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру: default Tabs повторює семантику HeroUI v3 —
 * neutral list, muted inactive foreground і окрема segment-поверхня active tab.
 * У light segment білий, у dark ІНВЕРТОВАНИЙ у майже білий (див. `--segment`
 * у `libs/ui/src/styles.css`); line variant
 * використовує primary як active indicator. Метрики й геометрія стокові.
 */

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center p-[3px] text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        // ЛОКАЛЬНА ПРАВКА реєстру: жолоб — ПРОЗОРА накладка, а не суцільний
        // `secondary`. Активний сегмент лежить прямо на ній, і суцільний фон
        // жолоба довелося б підбирати під кожну поверхню, на якій стоять таби
        // (картка, полотно, тулбар календаря)
        default: 'bg-accent',
        line: 'gap-1 bg-transparent',
      },
      // ЛОКАЛЬНА ПРАВКА реєстру: у стоку розмір один. `sm` заведений, коли таби
      // переїхали в ХЕДЕР шела (календар, 2026-09-08): там вони стоять в одному
      // ряду з `Button size="sm"`, дзвінком і перемикачем теми, а стокові 36px
      // робили їх на голову вищими за сусідів. Міряється ЖОЛОБ (він і є видимий
      // контур контрола) — 32px, рівно як `h-8` кнопки; тригер усередині
      // вираховує свою висоту сам, тож зменшується разом із ним.
      size: {
        default: 'rounded-lg group-data-horizontal/tabs:h-9',
        sm: 'rounded-md group-data-horizontal/tabs:h-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      // data-size, а не лише клас: тригер підбирає під нього свою типографіку
      // й відступи селектором `group-data-[size=sm]/tabs-list:`
      data-size={size}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=default]/tabs-list:data-active:bg-segment group-data-[variant=default]/tabs-list:data-active:text-segment-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm',
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:shadow-none',
        // Тригер у вузькому жолобі: та сама типографіка, що в `Button size="sm"`
        // (`text-[0.8rem]`), і тісніші боки — інакше 32px контрол виглядав би
        // розпертим підписами
        'group-data-[size=sm]/tabs-list:rounded-sm group-data-[size=sm]/tabs-list:px-2 group-data-[size=sm]/tabs-list:text-[0.8rem]',
        'after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
