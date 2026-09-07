import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from 'lucide-react';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
} from '@saas-skeleton/ui/components/ui/combobox';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { UserPresenceBadge } from '../presence-dot';
import { UserPickerList } from './user-picker-list';
import { useUserDirectory } from './use-user-directory';
import { isResolved, type PickedOption, type UserOption } from './user-option';

interface UserMultiSelectProps {
  value: string[];
  onChange: (userIds: string[]) => void;
  /**
   * Ідентичності, які споживач уже має (учасники збереженої події). Без них
   * вибране, якого немає на поточній сторінці пошуку, рендериться скелетоном.
   */
  known?: UserOption[];
  /** Кого зі складу вибити не можна (організатор): без хрестика і сірий у списку */
  lockedIds?: string[];
  placeholder?: string;
  /** `aria-label` хрестика на чипі; за замовчуванням — «Remove user» */
  removeLabel?: string;
  disabled?: boolean;
  /** Для зв'язки з `FieldLabel htmlFor` */
  id?: string;
  isInvalid?: boolean;
  onBlur?: () => void;
}

/**
 * Вибір кількох юзерів ІНЛАЙНОМ: чипи живуть у самому полі.
 *
 * Побудований на `ComboboxChips` реєстру (Base UI `multiple`) — саме тому тут
 * немає ні власного стану відкриття, ні обробки Backspace, ні навігації
 * стрілками між чипами: усе це поведінка примітива.
 *
 * Одна свідома відмінність від `UserSelect`: **пошук живе в ПОЛІ, а не в
 * попапі**. В одиничному виборі інпут винесений у попап, щоб вибір не підставляв
 * ім'я в поле; тут підставляти нікуди — вибране стало чипом, а поле і так має
 * каретку. Побічний виграш: Backspace на порожньому полі знімає останній чип,
 * чого варіант із тригером-кнопкою дати не може.
 *
 * Межа застосування: поки чипів мало. На шести юзерах поле займає три рядки і
 * починає штовхати форму — там доречніший `UserMultiList`.
 */
export function UserMultiSelect({
  value,
  onChange,
  known,
  lockedIds = [],
  placeholder,
  removeLabel,
  disabled,
  id,
  isInvalid,
  onBlur,
}: UserMultiSelectProps) {
  const { t } = useTranslation('common');
  // Попап якориться до всього поля-чипів, а не до інпута всередині: інакше він
  // з'їжджав би за кареткою і мінявся б у ширині з кожним новим чипом
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const { options, picked, total, isFetching, query, setQuery } = useUserDirectory(value, known);

  return (
    <Combobox
      multiple
      items={options}
      value={picked}
      // Фільтрує СЕРВЕР: вбудований `contains` бачив би тільки завантажену
      // сторінку і на 21-му юзері починав би брехати «нічого не знайдено»
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
        // Закрили попап — прибираємо і фільтр: інакше наступне відкриття
        // показувало б залишок чужого запиту замість повного списку
        if (!open) {
          setQuery('');
        }
      }}
      onValueChange={(next: PickedOption[]) => {
        const ids = next.map((option) => option.id);
        // Захист від зняття заблокованого: у списку такий рядок вимкнений, але
        // прийти сюди він може ще й з клавіатури — і мовчазна втрата
        // організатора зі складу коштувала б дорожче за цей рядок
        const restored = lockedIds.filter((locked) => value.includes(locked) && !ids.includes(locked));
        onChange([...restored, ...ids]);
      }}
      disabled={disabled}
    >
      <div ref={anchorRef} className="relative">
        <ComboboxChips
          // Метрика поля: 36px = 28px чипа + 2×3px падінгу + 2×1px межі. Обидва
          // правила з падінгом мусять бути ПАРНИМИ до стокових: у реєстрі
          // `has-data-[slot=combobox-chip]:px-1` — селектор із `:has()`, і голий
          // `p-[3px]` за специфічністю йому не конкурент (той самий урок, що з
          // кнопками рейлу в `docs/frontend/app-shell.md`)
          className="min-h-9 gap-1 p-[3px] pr-8 transition-colors has-data-[slot=combobox-chip]:p-[3px] has-data-[slot=combobox-chip]:pr-8 hover:bg-field-hover"
        >
          {picked.map((option) => (
            <ComboboxChip
              key={option.id}
              showRemove={!lockedIds.includes(option.id)}
              removeLabel={removeLabel ?? t('userSelect.remove')}
              // Чип-пігулка замість стокового прямокутника 21px: усередині
              // круглий аватар, і квадратна рамка навколо кола читається як
              // помилка. Розмір хрестика перебивається селектором НАЩАДКА —
              // стокові класи на самій кнопці (`size-7` з `icon-xs`) важать
              // менше, тож перебивати «на місці» не довелось
              className="h-7 gap-1.5 rounded-full pl-[2px] text-sm font-normal has-data-[slot=combobox-chip-remove]:pr-[2px] [&_[data-slot=combobox-chip-remove]]:size-5 [&_[data-slot=combobox-chip-remove]]:opacity-60"
            >
              {isResolved(option) ? (
                <UserIdentity
                  size="sm"
                  showEmail={false}
                  email={option.email}
                  name={option.name}
                  avatarUrl={option.avatarUrl}
                  badge={<UserPresenceBadge userId={option.id} />}
                />
              ) : (
                <span className="flex items-center gap-3">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </span>
              )}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput
            id={id}
            onBlur={onBlur}
            aria-invalid={isInvalid ? true : undefined}
            // Плейсхолдер тільки на порожньому полі: поруч із чипами він
            // виглядав би як ще один, недоданий юзер
            placeholder={picked.length === 0 ? (placeholder ?? t('userSelect.add')) : undefined}
            className="h-7 px-1.5 placeholder:text-muted-foreground"
          />
        </ComboboxChips>
        {/* Шеврон декоративний: поле відкриває сам `ComboboxChips` (натискання
            будь-де в ньому фокусує інпут), тож окремий тригер лише перехоплював
            би кліки повз чипи. `top-2.5` — центр ПЕРШОГО рядка, а не всього
            поля: коли чипи переносяться, шеврон мусить лишитись там, де межа
            поля була до переносу */}
        <ChevronDownIcon className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-muted-foreground" />
      </div>

      <ComboboxContent anchor={anchorRef} align="start" sideOffset={4} className="p-0">
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
