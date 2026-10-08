import { collectNavigation, type NavigationModule } from '@saas-skeleton/ui/navigation';
import { workspaceArea } from './app-shell/workspace.nav';

/**
 * Composition root навігації (docs/modules.md §4–§5): ЄДИНЕ місце, що збирає розділи рейлу й
 * пункти їхніх меню та локальні меню сторінок із модулів. Модулі оголошують їх у `<module>.nav.ts`; список тут не
 * ведеться — `import.meta.glob` Vite перетворює на статичні імпорти на збірці (рантайм-
 * сканування немає), тож розмір бандла такий самий, як у ручного переліку. Прибрав теку
 * модуля — зник його розділ і пункти. Порядок задає `order` у кожному записі.
 *
 * `*.nav.ts` лишаються легкими: сторінки й важкі компоненти сюди не імпортуємо (ESLint),
 * бо `eager` затягне їх у головний чанк.
 */
const modules = import.meta.glob<NavigationModule>(['./app-shell/*.nav.ts', './features/*/*.nav.ts'], {
  eager: true,
  import: 'default',
});

export const NAVIGATION = collectNavigation(modules, { defaultArea: workspaceArea });
