'use client';

import * as React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  XIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const toast = ToastPrimitive.createToastManager();

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

/**
 * ЛОКАЛЬНА ПРАВКА реєстру (міграція platform-web на shadcn, §5.5.2 docs/migrate.md).
 * Реєстр уміє лише нижній правий кут, а застосунку треба два регіони: /login — знизу по
 * центру, сторінки адмінки — зверху праворуч. Base UI стакає тости від НИЖНЬОГО краю
 * viewport-а, тож верхня позиція — це офіційний рецепт Base UI: дзеркаляться `origin`,
 * `--offset-y`, transform стеку, ::after-проміжок і starting/ending-трансформи, плюс
 * `swipeDirection="up"`. Тримається двома константами нижче, щоб `shadcn add --diff`
 * лишався читабельним.
 */
type ToastAnchor = 'top' | 'bottom';
type ToastPosition = 'top-right' | 'bottom-right' | 'bottom-center';

const toastViewportPositionClasses: Record<ToastPosition, string> = {
  'top-right': 'top-4 sm:right-4 sm:left-auto sm:mx-0 sm:w-full',
  'bottom-right': 'bottom-4 sm:right-4 sm:left-auto sm:mx-0 sm:w-full',
  'bottom-center': 'bottom-4',
};

const toastAnchorClasses: Record<ToastAnchor, string> = {
  bottom: cn(
    'bottom-0 origin-bottom after:top-full',
    '[--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))]',
    '[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))]',
    'data-starting-style:[transform:translateY(150%)]',
    '[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]',
  ),
  top: cn(
    'top-0 origin-top after:bottom-full',
    '[--offset-y:calc(var(--toast-offset-y)+calc(var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))]',
    '[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek))+(var(--shrink)*var(--height))))_scale(var(--scale))]',
    'data-starting-style:[transform:translateY(-150%)]',
    '[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(-150%)]',
  ),
};

function ToastViewport({
  className,
  position = 'bottom-right',
  ...props
}: ToastPrimitive.Viewport.Props & { position?: ToastPosition }) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'pointer-events-none fixed inset-x-4 z-50 mx-auto w-auto max-w-sm outline-none',
        toastViewportPositionClasses[position],
        className,
      )}
      {...props}
    />
  );
}

function Toast({
  className,
  anchor = 'bottom',
  swipeDirection,
  ...props
}: ToastPrimitive.Root.Props & { anchor?: ToastAnchor }) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      swipeDirection={swipeDirection ?? (anchor === 'top' ? 'up' : undefined)}
      className={cn(
        'group/toast pointer-events-auto absolute right-0 z-[calc(1000-var(--toast-index))] w-full rounded-2xl border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        '[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]',
        'h-(--height) [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]',
        "after:absolute after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        'data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]',
        'data-limited:opacity-0',
        toastAnchorClasses[anchor],
        'data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]',
        'data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]',
        'data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]',
        'data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]',
        'data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]',
        'data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]',
        'data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]',
        'data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]',
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        'flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn('text-sm font-medium', className)}
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null;

  if (type === 'success') {
    icon = <CircleCheckIcon aria-hidden="true" />;
  }

  if (type === 'info') {
    icon = <InfoIcon aria-hidden="true" />;
  }

  if (type === 'warning') {
    icon = <TriangleAlertIcon aria-hidden="true" />;
  }

  if (type === 'error') {
    icon = <OctagonXIcon className="text-destructive" aria-hidden="true" />;
  }

  if (type === 'loading') {
    icon = <Loader2Icon className="animate-spin" aria-hidden="true" />;
  }

  if (!icon) {
    return null;
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function ToastList({ anchor }: { anchor: ToastAnchor }) {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem} anchor={anchor}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ));
}

function Toaster({
  children,
  toastManager = toast,
  position = 'bottom-right',
  ...props
}: ToastPrimitive.Provider.Props & { position?: ToastPosition }) {
  const anchor: ToastAnchor = position === 'top-right' ? 'top' : 'bottom';

  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport position={position}>
          <ToastList anchor={anchor} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export type { ToastPosition };
export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
