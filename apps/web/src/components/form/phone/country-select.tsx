import { Autocomplete, EmptyState, ListBox, SearchField, useFilter } from '@heroui/react';
import type { CountryCode } from 'libphonenumber-js';
import { useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { CountryFlag } from './country-flag';
import { findCountry, getCountryOptions } from './countries';

interface CountrySelectProps {
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  /**
   * Ref на InputGroup.Prefix. Через нього дістаємо саме поле (батьківський елемент
   * Prefix — це і є InputGroup) і вирівнюємо попап по ньому: HeroUI жорстко прив'язує
   * попап до вузької кнопки-тригера, і без вирівнювання дропдаун висів би окремим
   * прямокутником збоку замість того, щоб читатися як продовження поля
   */
  prefixRef: RefObject<HTMLDivElement | null>;
  isDisabled?: boolean;
}

/** Ширина попапа = ширина всього поля; зсув компенсує відступ тригера від краю поля */
interface PopoverAnchor {
  width: number;
  crossOffset: number;
}

/**
 * Вибір країни всередині поля телефону. Це саме Autocomplete, а не ComboBox: ComboBox
 * САМ є текстовим полем, тобто вимагав би від користувача друкувати назву країни в те
 * саме місце, де стоїть номер. Autocomplete лишає тригер кнопкою (прапор + код набору),
 * а пошук виносить у попап — стандартний UX телефонних полів.
 *
 * Клавіатурна навігація, фокус-трап і a11y — від React Aria під HeroUI, свого не пишемо.
 */
export function CountrySelect({
  country,
  onCountryChange,
  prefixRef,
  isDisabled,
}: CountrySelectProps) {
  const { t, i18n } = useTranslation('common');
  const { contains } = useFilter({ sensitivity: 'base' });

  const countries = getCountryOptions(i18n.language);
  const selected = findCountry(i18n.language, country);

  const [anchor, setAnchor] = useState<PopoverAnchor>({ width: 0, crossOffset: 0 });

  /**
   * Міряємо саме при відкритті, а НЕ в layout-ефекті на монтуванні: React у commit-фазі
   * встановлює ref батьківського елемента (Prefix) вже після layout-ефектів його дітей,
   * тож на той момент prefixRef.current ще null і вимір мовчки не відбувався б.
   * Тут же refs гарантовано готові, а setState потрапляє в той самий батч, що й
   * відкриття попапа — тому перший кадр малюється вже з правильною геометрією.
   */
  const measureAnchor = () => {
    const prefix = prefixRef.current;
    const field = prefix?.parentElement;
    // Саме data-slot, а не querySelector('button'): усередині тригера є ще кнопка-
    // індикатор, і вимір від неї давав зайвий зсув. Беремо через DOM, а не через
    // обгортку з ref — обгортка навколо Autocomplete.Trigger ламає сам Autocomplete
    const trigger = prefix?.querySelector('[data-slot="autocomplete-trigger"]');
    if (!field || !trigger) return;

    const fieldRect = field.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setAnchor({
      width: fieldRect.width,
      // Від'ємний: тягне попап уліво від тригера рівно на його відступ від краю поля
      crossOffset: fieldRect.left - triggerRect.left,
    });
  };

  return (
    <Autocomplete
      aria-label={t('phone.countryLabel')}
      isDisabled={isDisabled}
      selectionMode="single"
      onOpenChange={(open) => {
        if (open) measureAnchor();
      }}
      value={country}
      onChange={(key) => {
        // null приходить при скиданні вибору — країна ж завжди має бути якась
        if (typeof key === 'string') onCountryChange(key as CountryCode);
      }}
    >
      {/* Без Autocomplete.Indicator: дефолтний шеврон тут зайвий — роль дропдауна
          вже читається з прапора й коду, а стрілка з'їдала б ширину поля */}
      <Autocomplete.Trigger className="flex items-center gap-1.5 border-0 bg-transparent px-0 shadow-none">
        <CountryFlag country={country} />
        <span className="text-sm tabular-nums">+{selected?.callingCode ?? ''}</span>
      </Autocomplete.Trigger>
      {/* Дропдаун має читатися як продовження поля: та сама ширина, вирівняний по лівому
          краю, впритул знизу. Ширину задаємо ПЕРЕВИЗНАЧЕННЯМ --trigger-width, а не
          width: стилі HeroUI мають `w-(--trigger-width) max-w-(--trigger-width)`, і
          inline width перебив би лише перше — max-width усе одно різав би попап до
          ширини вузької кнопки. Наш style мерджиться після їхнього, тож змінна наша */}
      <Autocomplete.Popover
        placement="bottom start"
        offset={2}
        crossOffset={anchor.crossOffset}
        style={
          anchor.width
            ? ({ '--trigger-width': `${String(anchor.width)}px` } as CSSProperties)
            : undefined
        }
      >
        {/* filter отримує лише textValue елемента — тому в ньому зшиті всі пошукові
            токени (назва, ISO-код, код набору), див. CountryOption.searchText */}
        <Autocomplete.Filter filter={contains}>
          <SearchField name="country-search" variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              {/* autoFocus саме на Input, а не на SearchField: у модалці focus-trap
                  перехоплює фокус контейнера, і поле лишалося порожнім при наборі */}
              {/* autoFocus не потрібен: Autocomplete сам ставить фокус у поле пошуку
                  при відкритті попапа. aria-label — бо видимої мітки тут немає
                  (React Aria інакше пише попередження в консоль) */}
              <SearchField.Input
                aria-label={t('phone.searchCountry')}
                placeholder={t('phone.searchCountry')}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox
            // Нижче за 280px: разом із рядком пошуку попап має вміщатися ПІД полем,
            // інакше React Aria перекидає його вгору через брак місця у вікні
            className="max-h-[220px]"
            renderEmptyState={() => <EmptyState>{t('phone.noCountriesFound')}</EmptyState>}
          >
            {countries.map((option) => (
              <ListBox.Item key={option.code} id={option.code} textValue={option.searchText}>
                <span className="flex min-w-0 items-center gap-2">
                  <CountryFlag country={option.code} />
                  <span className="truncate">{option.name}</span>
                  <span className="text-muted tabular-nums">+{option.callingCode}</span>
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}
