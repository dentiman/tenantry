import { linkOptions } from '@tanstack/react-router';
import { CalendarCog, CalendarDays } from 'lucide-react';
import { defineArea, defineNavigation } from '@saas-skeleton/ui/navigation';
import { customerDetailMenu } from '../customers/customers.nav';
import { settingsArea } from '../settings/settings.nav';
import { CalendarSidebar } from './calendar-sidebar';

/**
 * Календар — власна area, а не пункт у Workspace: у нього своя друга колонка (міні-місяць, а не
 * меню) і власний URL-простір із періодами.
 */
export const calendarArea = defineArea({
  id: 'calendar',
  prefix: linkOptions({ to: '/calendar' }).to,
  label: 'layout:areas.calendar',
  icon: CalendarDays,
  order: 20,
  panel: CalendarSidebar,
});

export default defineNavigation({
  areas: [calendarArea],
  menuItems: [
    {
      id: 'calendar.customer-events',
      menu: customerDetailMenu,
      order: 30,
      link: linkOptions({
        from: '/workspace/customers/$customerId',
        to: '/workspace/customers/$customerId/events',
        params: true,
      }),
      label: 'calendar:customer.tab',
    },
  ],
  items: [
    {
      id: 'settings.calendar',
      area: settingsArea,
      order: 20,
      link: linkOptions({ to: '/settings/calendar' }),
      label: 'settings:nav.calendar',
      icon: CalendarCog,
    },
  ],
});
