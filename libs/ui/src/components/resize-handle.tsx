import { cn } from '@saas-skeleton/ui/lib/utils';
import { useResizablePanelWidth } from '@saas-skeleton/ui/hooks/use-resizable-panel-width';

interface ResizeHandleProps {
  cssVar: string;
  storageKey: string;
  defaultWidthPx: number;
  minWidthPx: number;
  maxRatio: number;
  /** У який бік екрана росте ширина при русі вказівника вправо */
  grow: 'right' | 'left';
  /** З якого боку панелі сидить хендл — визначає позиціювання */
  edge: 'left' | 'right';
  className?: string;
}

/**
 * Межа-хендл для зміни ширини сусідньої панелі — той самий візуальний ідіом,
 * що `SidebarRail` у реєстрі (`w-(...)` смуга-приціл із тонкою `after:`-лінією
 * по центру), але для БЕЗПЕРЕРВНОГО ресайзу, а не клацання-тогла: тягне мишею
 * (`useResizablePanelWidth`), клавіатурою (стрілки на фокусі) і скидає дабл-кліком.
 */
export function ResizeHandle({ edge, className, ...options }: ResizeHandleProps) {
  const handleProps = useResizablePanelWidth(options);

  return (
    <div
      {...handleProps}
      data-slot="resize-handle"
      className={cn(
        'absolute top-0 z-10 h-full w-2 shrink-0 cursor-col-resize touch-none select-none',
        'after:absolute after:inset-y-0 after:start-1/2 after:w-px after:bg-transparent after:transition-colors',
        'hover:after:bg-sidebar-border focus-visible:after:bg-sidebar-ring focus-visible:outline-hidden',
        // Половина хендла лежить у панелі, половина — за нею: `translate-x-1/2`
        // зсуває його на половину ВЛАСНОЇ ширини, і `after`-лінія опиняється
        // рівно на межі панелі, а не всередині чи ззовні неї
        edge === 'right' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2',
        className,
      )}
    />
  );
}
