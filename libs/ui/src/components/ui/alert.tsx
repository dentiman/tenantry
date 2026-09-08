import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@saas-skeleton/ui/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        // ЛОКАЛЬНА ПРАВКА реєстру: варіант `warning` — попередження, яке НЕ є
        // помилкою («час показано в іншій зоні»). Реєстр пропонує робити це
        // хардкодом `bg-amber-50 dark:bg-amber-950` на місці використання
        // (розділ «Custom Colors» у документації) — ми беремо той самий намір,
        // але через наш токен `--warning`: інакше дві теми й dark-режим
        // доводилось би розписувати в кожному виклику. Мʼякий фон і opacity
        // опису — ті самі, що в `badge` варіанті `warning`
        warning:
          "border-warning/30 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning/90 *:[svg]:text-current",
      },
      // ЛОКАЛЬНА ПРАВКА реєстру: кольорова смужка ліворуч. У реєстрі такого
      // виміру немає — найближчий аналог в індустрії зветься
      // `Alert variant="left-accent"` (Chakra UI) або `Callout`; довідник назв
      // і посилання — docs/frontend/ui-registry.md §4.8
      accent: {
        none: "",
        left: "border-l-[3px]",
      },
    },
    compoundVariants: [
      // Колір смужки — колір самого варіанта; окремим виміром задається лише
      // ТОВЩИНА, інакше `border-l-<колір>` фарбував би й звичайну 1px межу
      { variant: "default", accent: "left", class: "border-l-border" },
      { variant: "destructive", accent: "left", class: "border-l-destructive" },
      { variant: "warning", accent: "left", class: "border-l-warning" },
    ],
    defaultVariants: {
      variant: "default",
      accent: "none",
    },
  }
)

function Alert({
  className,
  variant,
  accent,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, accent }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
