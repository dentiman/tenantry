import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { Building2Icon } from 'lucide-react';
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

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface CustomerOption {
  id: string;
  name: string;
  numberLabel: string;
}

/**
 * Вибір кастомера для привʼязки події. Той самий рецепт, що `UserSelect`
 * (серверний пошук + гідрація вибраного окремим запитом), тільки без аватарів:
 * розводити їх в один generic-компонент означало б параметризувати і запит, і
 * рендер рядка — більше абстракції, ніж коду.
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
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data, isFetching } = useCustomersFindAll(
    { search: search || undefined, limit: PAGE_SIZE, sortBy: 'name', sortOrder: 'asc' },
    { query: { placeholderData: keepPreviousData } },
  );
  const customers = data?.items ?? [];
  const inPage = customers.find((customer) => customer.id === value) ?? null;
  const { data: fetched } = useCustomersFindOne(value ?? '', {
    query: { enabled: value !== null && inPage === null },
  });
  const selected: CustomerOption | null = inPage ?? (fetched?.id === value ? fetched : null);

  return (
    <Combobox
      items={customers}
      value={selected}
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
      <div ref={anchorRef} className="group relative">
        <ComboboxTrigger
          id={id}
          className="flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-field py-1 pr-2.5 pl-3 text-sm transition-colors outline-none select-none group-has-data-[slot=combobox-clear]:pr-9 group-has-data-[slot=combobox-clear]:[&>svg]:hidden hover:bg-field-hover focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selected ? (
              <>
                <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{selected.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {selected.numberLabel}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Building2Icon className="size-4" />
                {t('form.customerNone')}
              </span>
            )}
          </span>
        </ComboboxTrigger>
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
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{option.name}</span>
                <span className="text-xs text-muted-foreground">{option.numberLabel}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
