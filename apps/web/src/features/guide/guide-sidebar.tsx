import { useTranslation } from 'react-i18next';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@saas-skeleton/ui/components/ui/sidebar';
import { GUIDE_SECTIONS } from './pages/guide.content';
import { useGuideSectionStore } from './stores/guide-section.store';

/**
 * Друга колонка area «Guide» — зміст путівника.
 *
 * Третій випадок «колонка ≠ меню роутів» (після чату й календаря): пункти — не
 * сторінки, а параграфи ОДНІЄЇ довгої сторінки. Активний пункт іде за прокруткою,
 * клік прокручує до параграфа; URL при цьому не змінюється — параграф не є
 * навігаційним станом, який мусить переживати F5.
 */
export function GuideSidebar() {
  const { t } = useTranslation('guide');
  const activeId = useGuideSectionStore((state) => state.activeId);
  const scrollTo = useGuideSectionStore((state) => state.scrollTo);
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {GUIDE_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <SidebarMenuItem key={section.id}>
                <SidebarMenuButton
                  isActive={section.id === activeId}
                  onClick={() => {
                    scrollTo(section.id);
                    // На мобільному сайдбар — Sheet поверх контенту: інакше він
                    // закривав би параграф, до якого щойно прокрутили
                    if (isMobile) {
                      setOpenMobile(false);
                    }
                  }}
                >
                  <Icon />
                  <span>{t(`sections.${section.id}`)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
