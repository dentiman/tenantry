import {
  AlignLeftIcon,
  ChevronRightIcon,
  ComponentIcon,
  NetworkIcon,
  PanelTopIcon,
  RectangleHorizontalIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@saas-skeleton/ui/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { AreaNav } from '../area-nav';
import { isUnder } from '../paths';

/**
 * Мітка підгрупи всередині розкритого «Components». НЕ колапсовна — просто
 * заголовок над своїм списком, а не другий рівень акордеона: юзер попросив,
 * щоб розкривався лише сам «Components», а General/Platform були статичним
 * поділом. `<div>`, а не `SidebarGroupLabel` — той стилізований під шапку
 * `SidebarGroup`, тут це підпис усередині `CollapsibleContent`.
 */
function ComponentsSubgroupLabel({ children }: { children: string }) {
  return (
    <div className="mx-3.5 mt-2 px-2.5 text-[11px] font-medium tracking-wide text-sidebar-foreground/60 uppercase first:mt-1.5">
      {children}
    </div>
  );
}

/**
 * Друга колонка area «Playground» — візуальні стенди примітивів UI.
 *
 * Стенд додається рядком тут + роутом, а не грудкою якорів на одній сторінці,
 * як було до area.
 *
 * «Components» — окреме підменю з каталогом примітивів окремими сторінками
 * (`/playground/components/*`), яке розкривається/згортається (`Collapsible`);
 * усередині — дві логічні підгрупи без власного колапсу:
 * **General Components** (спільна `libs/ui`, придатна й для `platform-web`,
 * напр. Buttons) і **Platform Components** (бізнес-орієнтовані, з бекендом,
 * лише в tenant-порталі, напр. User Select). Решта стендів (форми, dialog,
 * architecture) лишаються пласким списком нижче — вони не про каталог
 * примітивів, а про компоновку/сценарії.
 */
export function PlaygroundSidebar() {
  const { t } = useTranslation('playground');
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <Collapsible defaultOpen className="group/collapsible" render={<SidebarMenuItem />}>
              <CollapsibleTrigger
                render={
                  <SidebarMenuButton isActive={isUnder(pathname, '/playground/components')} />
                }
              >
                <ComponentIcon />
                <span>{t('nav.components')}</span>
                <ChevronRightIcon className="ml-auto shrink-0 text-icon-muted transition-transform duration-200 group-data-open/collapsible:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden">
                <ComponentsSubgroupLabel>{t('nav.generalComponents')}</ComponentsSubgroupLabel>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/buttons'}
                      render={<Link to="/playground/components/buttons" />}
                    >
                      {t('nav.buttons')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/combobox'}
                      render={<Link to="/playground/components/combobox" />}
                    >
                      {t('nav.combobox')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/data-grid'}
                      render={<Link to="/playground/components/data-grid" />}
                    >
                      {t('nav.dataGrid')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/input'}
                      render={<Link to="/playground/components/input" />}
                    >
                      {t('nav.input')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/select'}
                      render={<Link to="/playground/components/select" />}
                    >
                      {t('nav.select')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/tabs'}
                      render={<Link to="/playground/components/tabs" />}
                    >
                      {t('nav.tabs')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/textarea'}
                      render={<Link to="/playground/components/textarea" />}
                    >
                      {t('nav.textarea')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <ComponentsSubgroupLabel>{t('nav.platformComponents')}</ComponentsSubgroupLabel>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      isActive={pathname === '/playground/components/user-select'}
                      render={<Link to="/playground/components/user-select" />}
                    >
                      {t('nav.userSelect')}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <AreaNav
        items={[
          {
            to: '/playground/vertical-form',
            label: t('nav.verticalForm'),
            icon: <AlignLeftIcon />,
            match: 'exact',
          },
          {
            to: '/playground/inline-form',
            label: t('nav.inlineForm'),
            icon: <RectangleHorizontalIcon />,
            match: 'exact',
          },
          {
            to: '/playground/dialog',
            label: t('nav.dialog'),
            icon: <PanelTopIcon />,
            match: 'exact',
          },
          {
            to: '/playground/architecture',
            label: t('nav.architecture'),
            icon: <NetworkIcon />,
            match: 'exact',
          },
        ]}
      />
    </>
  );
}
