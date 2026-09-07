/**
 * Мінімум, який рендерять обидва варіанти вибору кількох юзерів. Локальний тип,
 * а не generated: список (`UserListResponseDtoOutputItemsItem`), картка
 * (`UserResponseDtoOutput`) і вкладений `CalendarUserRef` — три різні orval-типи
 * з однією й тією ж формою, і всі троє підходять сюди структурно. Та сама
 * причина, що в `UserSelect`.
 */
export interface UserOption {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Вибраний id, для якого ідентичності ще немає. Виникає рівно в одному випадку:
 * форма прийшла зі значенням (учасники збереженої події), а сторінка юзерів під
 * поточний пошук його не містить і споживач не передав його в `known`.
 *
 * Окремий тип, а не `UserOption` із порожнім email: чип із порожнім рядком
 * замість імені мовчки виглядав би як юзер без імені, а це різні речі — «ще не
 * знаю, хто це» мусить рендеритись скелетоном.
 */
export interface PendingUserOption {
  id: string;
  pending: true;
}

export type PickedOption = UserOption | PendingUserOption;

export function isResolved(option: PickedOption): option is UserOption {
  return !('pending' in option);
}
