import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxTrigger,
} from '@saas-skeleton/ui/components/ui/combobox';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { UserPresenceBadge } from '../presence-dot';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { UserPickerList } from './user-picker-list';
import { useRowReorder } from './use-row-reorder';
import { useUserDirectory } from './use-user-directory';
import { isResolved, type PickedOption, type UserOption } from './user-option';

interface UserMultiListProps {
  value: string[];
  onChange: (userIds: string[]) => void;
  /** Ідентичності, які споживач уже має (учасники збереженої події) */
  known?: UserOption[];
  /** Кого зі складу вибити не можна: рядок без хрестика, без ручки і перший */
  lockedIds?: string[];
  /**
   * Перетягування рядків. За замовчуванням ВИМКНЕНЕ і це не обережність:
   * ручка обіцяє, що порядок збережеться, тож вмикати її можна лише там, де
   * споживач справді пише `value` як послідовність. Для учасників події
   * (сервер віддає їх відсортованими) обіцянка була б порожньою.
   */
  reorderable?: boolean;
  /** Правий край рядка — напр. RSVP-бейдж учасника */
  renderRowEnd?: (option: UserOption) => ReactNode;
  /** Підпис кнопки-слота; за замовчуванням — «Add a user» */
  addLabel?: string;
  /** `aria-label` хрестика; за замовчуванням — «Remove user» */
  removeLabel?: string;
  /** `aria-label` ручки; за замовчуванням — «Reorder user» */
  reorderLabel?: string;
  disabled?: boolean;
}

/**
 * Вибір кількох юзерів ВЕРТИКАЛЬНО: список рядків, а не поле.
 *
 * Різниця з `UserMultiSelect` не в щільності, а в тому, що рядок має ПРАВИЙ
 * КРАЙ: у 28px чипа не влазить ні бейдж RSVP, ні «Organiser», ні ручка
 * перетягування. Тому все, що несе стан ПРО кожного юзера, живе тут.
 *
 * Постійного контролу над списком немає: поки нікого не додали, весь компонент —
 * це кнопка. Вона ж і є порожнім рядком списку — та сама висота, той самий
 * радіус і той самий пунктир, що в місця, яке лишає піднятий рядок.
 *
 * Попап — той самий `UserSelect`-івський: серверний пошук, 20 рядків, чесний
 * підсумок. Пошук тут живе В ПОПАПІ (на відміну від інлайнового варіанта):
 * поля з кареткою на екрані немає взагалі.
 */
export function UserMultiList({
  value,
  onChange,
  known,
  lockedIds = [],
  reorderable = false,
  renderRowEnd,
  addLabel,
  removeLabel,
  reorderLabel,
  disabled,
}: UserMultiListProps) {
  const { t } = useTranslation('common');
  // Попап якориться до кнопки-слота: вона на всю ширину, тож список приходить
  // рівно тієї ж ширини, що й рядки над ним
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const { options, picked, total, isFetching, query, setQuery } = useUserDirectory(value, known);
  const { dragId, handleProps } = useRowReorder(value, onChange, reorderable, lockedIds);

  // Чи є в списку хоч один рядок із хрестиком: якщо є, закріплений тримає під
  // нього порожнє місце — інакше його бейдж стояв би на 32px правіше за всі інші
  const hasRemovableRows = picked.some((option) => !lockedIds.includes(option.id));

  return (
    <Combobox
      multiple
      items={options}
      value={picked}
      filter={null}
      inputValue={query}
      isItemEqualToValue={(a: PickedOption, b: PickedOption) => a.id === b.id}
      itemToStringLabel={(option: PickedOption) =>
        isResolved(option) ? (option.name ?? option.email) : ''
      }
      onInputValueChange={(next: string) => {
        setQuery(next);
      }}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setQuery('');
        }
      }}
      onValueChange={(next: PickedOption[]) => {
        const ids = next.map((option) => option.id);
        const restored = lockedIds.filter((locked) => value.includes(locked) && !ids.includes(locked));
        onChange([...restored, ...ids]);
      }}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1.5">
        {picked.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {picked.map((option) => {
              const isLocked = lockedIds.includes(option.id);
              const isDragging = dragId === option.id;
              return (
                <li
                  key={option.id}
                  data-row
                  className={cn(
                    'group/row flex h-12 items-center gap-2 rounded-md border bg-card py-0 pr-1 transition-colors',
                    reorderable ? 'pl-0.5' : 'pl-2',
                    // Піднятий рядок лишає собі власну поверхню і бере кільце
                    // з тінню; hover на ньому вимкнений — під пальцем він і так
                    // виділений, а зміна фону на кожному кроці читалась би як блимання
                    isDragging ? 'border-ring shadow-md' : 'hover:bg-muted',
                  )}
                >
                  {reorderable &&
                    (isLocked ? (
                      // Заблокований рядок ручки не має, але місце під неї
                      // тримає: інакше аватар організатора стояв би на 24px
                      // лівіше за всі інші й список утратив би вертикаль
                      <span aria-hidden className="w-6 shrink-0" />
                    ) : (
                      <button
                        type="button"
                        aria-label={reorderLabel ?? t('userSelect.reorder')}
                        disabled={disabled}
                        className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-input opacity-75 outline-none transition-opacity group-hover/row:text-muted-foreground group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:pointer-events-none"
                        {...handleProps(option.id)}
                      >
                        <GripVerticalIcon className="size-4" />
                      </button>
                    ))}

                  <div className="flex min-w-0 flex-1 items-center">
                    {isResolved(option) ? (
                      // Аватар СТАНДАРТНИЙ (32px), а не `sm`: рядок тут 48px, і
                      // в нього поміщається звичайна метрика зі звичайним
                      // кеглем — компактний варіант заводили для чипа 28px, де
                      // іншого виходу немає. Один список — одна метрика
                      // ідентичності з таблицею юзерів
                      <UserIdentity
                        email={option.email}
                        name={option.name}
                        avatarUrl={option.avatarUrl}
                        badge={<UserPresenceBadge userId={option.id} />}
                      />
                    ) : (
                      // Скелет тримає ТУ САМУ геометрію, що ідентичність поруч:
                      // інакше рядок сіпався б у мить, коли приїхали імена
                      <span className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <span className="flex flex-col gap-1.5">
                          <Skeleton className="h-3.5 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isResolved(option) && renderRowEnd?.(option)}
                    {isLocked ? (
                      hasRemovableRows && <span aria-hidden className="size-8" />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={removeLabel ?? t('userSelect.remove')}
                        disabled={disabled}
                        onClick={() => {
                          onChange(value.filter((id) => id !== option.id));
                        }}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div ref={anchorRef}>
          {/* Плоска кнопка, а не `Button`: це не дія в ряду інших дій, а
              порожній РЯДОК СПИСКУ — геометрію їй задає рядок (48px, radius-md,
              пунктир), і жоден варіант кнопки такої форми не має. Той самий
              випадок, що `FileDropzone`: примітива під нього в реєстрі немає */}
          <ComboboxTrigger
            showChevron={false}
            disabled={disabled}
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input bg-muted/60 text-sm font-medium text-muted-foreground outline-none transition-colors hover:border-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon />
            {addLabel ?? t('userSelect.add')}
          </ComboboxTrigger>
        </div>
      </div>

      <ComboboxContent anchor={anchorRef} align="start" sideOffset={4} className="p-0">
        <div className="border-b p-1">
          <ComboboxInput
            aria-label={t('userSelect.search')}
            placeholder={t('userSelect.search')}
            showTrigger={false}
          />
        </div>
        <UserPickerList
          shown={options.length}
          total={total}
          isFetching={isFetching}
          lockedIds={lockedIds}
        />
      </ComboboxContent>
    </Combobox>
  );
}
