import { collectNavigation, type NavigationModule } from '@saas-skeleton/ui/navigation';
import { tenantsArea } from './features/tenants/tenants.nav';

/**
 * Composition root навігації консолі — дзеркало `apps/web/src/nav.ts` (там повне
 * обґрунтування): розділи рейлу й пункти меню збираються з `<module>.nav.ts` модулів,
 * список тут не ведеться. Порядок задає `order` у кожному записі.
 */
const modules = import.meta.glob<NavigationModule>('./features/*/*.nav.ts', {
  eager: true,
  import: 'default',
});

export const NAVIGATION = collectNavigation(modules, { defaultArea: tenantsArea });
