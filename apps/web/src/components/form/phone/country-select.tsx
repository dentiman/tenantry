import type { CountryCode } from 'libphonenumber-js';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@saas-skeleton/ui/components/ui/combobox';
import { CountryFlag } from './country-flag';
import { findCountry, getCountryOptions, type CountryOption } from './countries';

interface CountrySelectProps {
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  /**
   * Ref на InputGroup усього поля — попап якориться до нього, а не до вузької кнопки:
   * дропдаун має читатися як продовження поля. Base UI сам віддає ширину якоря
   * змінною `--anchor-width`, тож ручного виміру геометрії тут більше немає
   * (UI-1, костиль 4 у docs/migrate-web.md §3.2).
   */
  anchorRef: RefObject<HTMLDivElement | null>;
  isDisabled?: boolean;
}

/**
 * Вибір країни всередині поля телефону. Тригер лишається кнопкою (прапор + код набору),
 * а пошук живе в попапі — інакше користувач друкував би назву країни в те саме місце,
 * де стоїть номер. Фільтрація вбудована в Base UI Combobox (`items` + дефолтний
 * локале-залежний `contains` по `itemToStringLabel`).
 */
export function CountrySelect({
  country,
  onCountryChange,
  anchorRef,
  isDisabled,
}: CountrySelectProps) {
  const { t, i18n } = useTranslation('common');
  const countries = getCountryOptions(i18n.language);
  const selected = findCountry(i18n.language, country);

  return (
    <Combobox
      items={countries}
      value={selected ?? null}
      onValueChange={(option: CountryOption | null) => {
        // null приходить при скиданні вибору — країна ж завжди має бути якась
        if (option) {
          onCountryChange(option.code);
        }
      }}
      // У пошук іде зшитий рядок (назва, ISO-код, код набору) — див. CountryOption.searchText
      itemToStringLabel={(option: CountryOption) => option.searchText}
      disabled={isDisabled}
    >
      <ComboboxTrigger
        aria-label={t('phone.countryLabel')}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <CountryFlag country={country} />
        <span className="tabular-nums">+{selected?.callingCode ?? ''}</span>
      </ComboboxTrigger>

      <ComboboxContent anchor={anchorRef} align="start" sideOffset={4} className="p-0">
        <div className="border-b p-1">
          <ComboboxInput
            aria-label={t('phone.searchCountry')}
            placeholder={t('phone.searchCountry')}
            showTrigger={false}
          />
        </div>
        <ComboboxEmpty>{t('phone.noCountriesFound')}</ComboboxEmpty>
        {/* Нижче за 280px: разом із рядком пошуку попап має вміщатися ПІД полем,
            інакше Base UI перекидає його вгору через брак місця у вікні */}
        <ComboboxList className="max-h-[220px]">
          {(option: CountryOption) => (
            <ComboboxItem key={option.code} value={option}>
              <span className="flex min-w-0 items-center gap-2">
                <CountryFlag country={option.code} />
                <span className="truncate">{option.name}</span>
                <span className="tabular-nums text-muted-foreground">+{option.callingCode}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
