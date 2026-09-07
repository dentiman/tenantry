import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { Building2Icon } from 'lucide-react';
import type { CustomerKind } from '@saas-skeleton/contracts';
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
import { useDebouncedValue } from '@saas-skeleton/ui/hooks/use-debounced-value';
import { useCustomersFindAll, useCustomersFindOne } from '../../api/generated/api';
import { CustomerIdentity } from '../customer-identity';

/** Скільки кастомерів показуємо за раз; решта — через уточнення пошуку */
const PAGE_SIZE = 20;
/** Та сама затримка, що в пошуку гріда (`useDataGridFilters`) */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Мінімум, який компонент рендерить. Локальний тип, а не generated: список
 * (`CustomerListResponseDtoOutputItemsItem`) і картка (`CustomerDetailResponseDtoOutput`) —
 * два різних orval-типи з ідентичною формою, і обидва підходять сюди структурно.
 * Склад полів диктує `CustomerIdentity`: `kind` кодує форму медіа, а другий рядок
 * блоку сам вибирає перше наявне з email → телефон → номер.
 */
interface CustomerOption {
  id: string;
  kind: CustomerKind;
  name: string;
  email: string | null;
  phone: string | null;
  numberLabel: string;
}

/**
 * Вибір кастомера для привʼязки події. Той самий рецепт, що `UserSelect`
 * (`components/user-select.tsx`): серверний пошук, гідрація вибраного окремим
 * запитом, чесна межа сторінки замість тихого обрізання — і той самий вигляд
 * рядка: двоярусна ідентичність з медіа замість плоского тексту. Тільки блок
 * інший — `CustomerIdentity` доменний і живе в застосунку, бо `Customer` існує
 * лише в tenant-плані.
 *
 * Спільного generic-компонента з `UserSelect` немає свідомо: параметризувати
 * довелося б і запит, і гідрацію, і рендер рядка — це більше абстракції, ніж
 * самого коду.
 */
export function CustomerSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string | null;
  onChange: (customerId: string | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useTranslation('calendar');
  const { t: tCommon } = useTranslation('common');
  // Попап якориться до всього поля, а не до тригера-кнопки: ширину віддає
  // Base UI змінною --anchor-width (той самий прийом, що в `UserSelect`)
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data, isFetching } = useCustomersFindAll(
    { search: search || undefined, limit: PAGE_SIZE, sortBy: 'name', sortOrder: 'asc' },
    // placeholderData: між запитами під набір список не має блимати порожнім
    { query: { placeholderData: keepPreviousData } },
  );
  const customers = data?.items ?? [];
  const total = data?.total ?? 0;

  // Вибраний кастомер може бути ПОЗА сторінкою результатів — інший пошук, інша
  // сторінка, або він уже в архіві (дефолтний список архів ховає). Тоді
  // ідентичність добирається окремим запитом, а не приходить пропом
  const inPage = customers.find((customer) => customer.id === value) ?? null;
  const { data: fetched } = useCustomersFindOne(value ?? '', {
    query: { enabled: value !== null && inPage === null },
  });
  const selected: CustomerOption | null = inPage ?? (fetched?.id === value ? fetched : null);
  // Значення є, а ідентичності ще немає — показуємо спінер, а не порожній тригер
  const isHydrating = value !== null && selected === null;

  return (
    <Combobox
      items={customers}
      value={selected}
      // Фільтрує СЕРВЕР: вбудований `contains` бачив би тільки завантажену
      // сторінку і на 21-му кастомері починав би брехати «нічого не знайдено»
      filter={null}
      isItemEqualToValue={(a: CustomerOption, b: CustomerOption) => a.id === b.id}
      itemToStringLabel={(option: CustomerOption) => option.name}
      onInputValueChange={(next: string) => {
        setQuery(next);
      }}
      onValueChange={(option: CustomerOption | null) => {
        onChange(option?.id ?? null);
      }}
      disabled={disabled}
    >
      {/* `group` — щоб тригер бачив змонтоване скидання: Base UI ставить X СЕСТРОЮ,
          і без :has() вбудований шеврон не знав би, що має поступитись слотом */}
      <div ref={anchorRef} className="group relative">
        <ComboboxTrigger
          id={id}
          // `min-h-9` замість фіксованої висоти: ідентичність — два рядки, а
          // метрика 36px описує ОДНОрядкові контроли (те саме, що в `UserSelect`)
          className="flex min-h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-field py-1 pr-2.5 pl-3 text-sm transition-colors outline-none select-none group-has-data-[slot=combobox-clear]:pr-9 group-has-data-[slot=combobox-clear]:[&>svg]:hidden hover:bg-field-hover focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex min-w-0 flex-1 items-center">
            {selected ? (
              <CustomerIdentity
                size="sm"
                kind={selected.kind}
                name={selected.name}
                email={selected.email}
                phone={selected.phone}
                numberLabel={selected.numberLabel}
              />
            ) : isHydrating ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                {tCommon('loading')}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Building2Icon className="size-4" />
                {t('form.customerNone')}
              </span>
            )}
          </span>
        </ComboboxTrigger>
        {/* X — СЕСТРА тригера, а не його дитина: кнопка в кнопці невалідна.
            Позиціонування — рецепт `UserSelect`: `inset-y-0 my-auto` (а не
            `-translate-y-1/2`, який злітав би від `active:translate-y-px` кнопки)
            і `right-[7px]` = 6px відступу + 1px межі поля, щоб іконка стала РІВНО
            у слот шеврона */}
        <ComboboxClear
          aria-label={t('form.customerClear')}
          className="absolute inset-y-0 right-[7px] my-auto"
        />
      </div>

      <ComboboxContent anchor={anchorRef} align="start" sideOffset={4} className="p-0">
        <div className="border-b p-1">
          <ComboboxInput
            aria-label={t('form.customerSearch')}
            placeholder={t('form.customerSearch')}
            showTrigger={false}
          />
        </div>
        <ComboboxEmpty>{isFetching ? <Spinner /> : t('form.customerNotFound')}</ComboboxEmpty>
        <ComboboxList className="max-h-[248px]">
          {(option: CustomerOption) => (
            <ComboboxItem key={option.id} value={option} className="py-1.5">
              <CustomerIdentity
                size="sm"
                kind={option.kind}
                name={option.name}
                email={option.email}
                phone={option.phone}
                numberLabel={option.numberLabel}
              />
            </ComboboxItem>
          )}
        </ComboboxList>
        {/* Чесна межа замість тихого обрізання: «нічого не знайдено» і «є ще, але
            не тут» — різні речі, і друге мусить бути видно */}
        {total > customers.length && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {t('form.customerRefine', { shown: customers.length, total })}
          </p>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
