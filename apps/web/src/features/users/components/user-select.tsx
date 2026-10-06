import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { UserRoundIcon } from 'lucide-react';
import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@saas-skeleton/ui/components/ui/combobox';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { UserPresenceBadge } from '../../realtime/components/presence-dot';
import { useDebouncedValue } from '@saas-skeleton/ui/hooks/use-debounced-value';
import { useUsersFindAll, useUsersFindOne } from '../../../api/generated/api';

/** Скільки юзерів показуємо за раз; решта — через уточнення пошуку */
const PAGE_SIZE = 20;
/** Та сама затримка, що в пошуку гріда (`useDataGridFilters`) */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Мінімум, який компонент рендерить. Локальний тип, а не generated: список
 * (`UserListResponseDtoOutputItemsItem`) і картка (`UserResponseDtoOutput`) — два
 * різних orval-типи з ідентичною формою, і обидва підходять сюди структурно.
 */
interface UserOption {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Пункт «нічий» — окремий об'єкт із `id: null`, а не рядок-sentinel: значенням
 * поля лишається або uuid, або справжній `null` (у БД `customers.owner_id` якраз
 * nullable), тож хак `UNASSIGNED = ''` із селектів більше не потрібен.
 */
const UNASSIGNED = { id: null } as const;

type Option = UserOption | typeof UNASSIGNED;

function isUser(option: Option): option is UserOption {
  return option.id !== null;
}

interface UserSelectProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Пункт «нічий» у списку. Вимкнути там, де відповідальний обов'язковий */
  allowUnassigned?: boolean;
  /** Текст порожнього стану; за замовчуванням — «Unassigned» */
  placeholder?: string;
  disabled?: boolean;
  /** Для зв'язки з `FieldLabel htmlFor` */
  id?: string;
  isInvalid?: boolean;
  onBlur?: () => void;
}

/**
 * Вибір юзера тенанта. Контрольований і НЕ прив'язаний до react-hook-form —
 * форма отримує його через `FormUserSelect`, а фільтри списків і швидкі дії на
 * картці можуть узяти цей компонент напряму (`CustomerQuerySchema.ownerId`).
 *
 * Джерело даних інкапсульоване: споживач передає `value`/`onChange` і не знає ні
 * про ендпоінт, ні про пагінацію, ні про те, що неактивних юзерів не пропонуємо.
 *
 * Це не автокомпліт: попап відкривається вже зі списком (запит без `search`), а
 * набір тексту лише звужує його. Base UI сам очищає інпут при кожному відкритті
 * (`AriaCombobox`: reason `inputClear`), тому «усі юзери» повертаються без нашого
 * коду. І оскільку інпут живе ВСЕРЕДИНІ попапа, вибір пункту не підставляє ім'я
 * в поле пошуку (`fillInputOnItemPress` діє лише для інпута-тригера) — інакше
 * після кожного вибору дебаунс вистрілював би запитом на ім'я вибраного.
 */
export function UserSelect({
  value,
  onChange,
  allowUnassigned = true,
  placeholder,
  disabled,
  id,
  isInvalid,
  onBlur,
}: UserSelectProps) {
  const { t } = useTranslation('common');
  // Попап якориться до всього поля, а не до тригера-кнопки: ширину віддає
  // Base UI змінною --anchor-width (той самий прийом, що в CountrySelect)
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data, isFetching } = useUsersFindAll(
    {
      search: search || undefined,
      isActive: 'true',
      limit: PAGE_SIZE,
      sortBy: 'name',
      sortOrder: 'asc',
    },
    // placeholderData: між запитами під набір список не має блимати порожнім
    { query: { placeholderData: keepPreviousData } },
  );
  const users = data?.items ?? [];
  const total = data?.total ?? 0;

  // Вибраний юзер може бути ПОЗА сторінкою результатів — інший пошук, інша
  // сторінка, або він уже деактивований. Тоді ідентичність добирається окремим
  // запитом, а не приходить пропом: споживач не має знати, чим наповнений список
  const inPage = users.find((user) => user.id === value) ?? null;
  const { data: fetched } = useUsersFindOne(value ?? '', {
    query: { enabled: value !== null && inPage === null },
  });
  const selected: UserOption | null =
    inPage ?? (fetched?.id === value ? fetched : null);
  // Значення є, а ідентичності ще немає — показуємо спінер, а не порожній тригер
  const isHydrating = value !== null && selected === null;

  const items: Option[] = allowUnassigned ? [UNASSIGNED, ...users] : users;

  return (
    <Combobox
      items={items}
      value={selected}
      // Фільтрує СЕРВЕР: вбудований `contains` бачив би тільки завантажену
      // сторінку і на 21-му юзері починав би брехати «нічого не знайдено»
      filter={null}
      isItemEqualToValue={(a: Option, b: Option) => a.id === b.id}
      itemToStringLabel={(option: Option) =>
        isUser(option) ? (option.name ?? option.email) : t('userSelect.unassigned')
      }
      onInputValueChange={(next: string) => {
        setQuery(next);
      }}
      onValueChange={(option: Option | null) => {
        onChange(option && isUser(option) ? option.id : null);
      }}
      disabled={disabled}
    >
      {/* `group` — щоб тригер бачив змонтоване скидання: Base UI ставить X СЕСТРОЮ,
          і без :has() вбудований шеврон не знав би, що має поступитись слотом */}
      <div ref={anchorRef} className="group relative">
        <ComboboxTrigger
          id={id}
          aria-invalid={isInvalid ? true : undefined}
          onBlur={onBlur}
          // Геометрія поля з `SelectTrigger` (той самий рецепт межі/фону/фокуса
          // ті самі `pr-2.5`/`pl-3` — інакше ні шеврон, ні вміст не стояли б на
          // одній вертикалі із сусідніми селектами форми), але `min-h-9` замість фіксованої
          // висоти: ідентичність — два рядки, а метрика 36px описує ОДНОрядкові
          // контроли. Поки є що чистити, шеврон ховається, а `pr-9` резервує його
          // слот під X — той самий прийом, що в `ComboboxInput` реєстру
          className="flex min-h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-field py-1 pr-2.5 pl-3 text-sm transition-colors outline-none select-none group-has-data-[slot=combobox-clear]:pr-9 group-has-data-[slot=combobox-clear]:[&>svg]:hidden hover:bg-field-hover focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/60 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/60"
        >
          <span className="flex min-w-0 flex-1 items-center">
            {selected ? (
              <UserIdentity
                id={selected.id}
                size="sm"
                email={selected.email}
                name={selected.name}
                avatarUrl={selected.avatarUrl}
                badge={<UserPresenceBadge userId={selected.id} />}
              />
            ) : isHydrating ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                {t('loading')}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <UserRoundIcon className="size-4" />
                {placeholder ?? t('userSelect.unassigned')}
              </span>
            )}
          </span>
        </ComboboxTrigger>
        {/* X — СЕСТРА тригера, а не його дитина: кнопка в кнопці невалідна.
            Base UI сам монтує її лише коли є що чистити.
            Центрується `inset-y-0 my-auto`, а НЕ `top-1/2 -translate-y-1/2`:
            `Button` на натисканні ставить `active:translate-y-px` — тією самою
            властивістю `translate`, тож центрувальний зсув злітав би на pointerdown,
            кнопка стрибала б на пів висоти вниз з-під курсора, pointerup потрапляв
            би вже в тригер і клік по X не скидав би значення взагалі.
            `right-[7px]` = 6px відступу + 1px межі поля, якої абсолютна кнопка
            не бачить: так іконка стає РІВНО у слот шеврона (обидві 16px за 11px
            від краю) і перемикання станів не рухає жодного пікселя */}
        <ComboboxClear
          aria-label={t('userSelect.clear')}
          className="absolute inset-y-0 right-[7px] my-auto"
        />
      </div>

      <ComboboxContent anchor={anchorRef} align="start" sideOffset={4} className="p-0">
        <div className="border-b p-1">
          <ComboboxInput
            aria-label={t('userSelect.search')}
            placeholder={t('userSelect.search')}
            showTrigger={false}
          />
        </div>
        <ComboboxEmpty>
          {isFetching ? <Spinner /> : t('userSelect.notFound')}
        </ComboboxEmpty>
        <ComboboxList className="max-h-[248px]">
          {(option: Option) =>
            isUser(option) ? (
              <ComboboxItem key={option.id} value={option} className="py-1.5">
                <UserIdentity
                  id={option.id}
                  size="sm"
                  email={option.email}
                  name={option.name}
                  avatarUrl={option.avatarUrl}
                  badge={<UserPresenceBadge userId={option.id} />}
                />
              </ComboboxItem>
            ) : (
              <ComboboxItem key="unassigned" value={option} className="py-2 pl-2">
                <span className="text-muted-foreground">{t('userSelect.unassigned')}</span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
        {/* Чесна межа замість тихого обрізання: «нічого не знайдено» і «є ще, але
            не тут» — різні речі, і друге мусить бути видно */}
        {total > users.length && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {t('userSelect.refine', { shown: users.length, total })}
          </p>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
