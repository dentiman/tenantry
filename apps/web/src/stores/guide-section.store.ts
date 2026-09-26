import { create } from 'zustand';
import { GUIDE_SECTIONS, type GuideSectionId } from '../pages/guide.content';

/**
 * Активний параграф путівника. Його ВИЗНАЧАЄ сторінка (`pages/guide.tsx` стежить
 * за прокруткою), а ЧИТАЄ друга колонка шела (`areas/guide-sidebar.tsx`), —
 * два компоненти в різних гілках дерева, тому стан у сторі, а не в пропсах.
 *
 * `scrollTo` теж тут: клік у сайдбарі не знає, де лежить секція і хто скролить
 * контент, а сторінка знає. Вона реєструє реалізацію при монтуванні.
 */
interface GuideSectionState {
  activeId: GuideSectionId;
  setActiveId: (id: GuideSectionId) => void;
  scrollTo: (id: GuideSectionId) => void;
  registerScrollTo: (scrollTo: (id: GuideSectionId) => void) => void;
}

export const useGuideSectionStore = create<GuideSectionState>((set) => ({
  activeId: GUIDE_SECTIONS[0].id,
  setActiveId: (activeId) => {
    set({ activeId });
  },
  scrollTo: () => undefined,
  registerScrollTo: (scrollTo) => {
    set({ scrollTo });
  },
}));
