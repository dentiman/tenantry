import { FieldError, InputGroup, Label, TextField } from '@heroui/react';
import type { CountryCode } from 'libphonenumber-js';
import { useEffect, useRef, useState } from 'react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { CountrySelect } from './phone/country-select';
import {
  formatAsYouType,
  getCountryHint,
  parsePastedInternational,
  stateFromE164,
  toE164,
} from './phone/phone-format';

interface FormPhoneFieldProps<T extends FieldValues> {
  control: Control<T>;
  /** Поле зберігає E.164 (`+380671234567`) або null — національний вигляд живе лише в UI */
  name: FieldPath<T>;
  label: string;
  /**
   * Країна з БД. Потрібна саме як окреме значення: за `+1` номер не відновлює країну
   * однозначно. Компонент її не пише — пару phone/phoneCountry зшиває форма на submit
   */
  countryValue?: string | null;
  onCountryChange?: (country: CountryCode) => void;
  placeholder?: string;
  /** 'secondary' — для полів на однотонній поверхні (модалки), як у решти обгорток */
  variant?: 'primary' | 'secondary';
  isDisabled?: boolean;
}

/**
 * Телефонне поле: вибір країни + національний номер, назовні — завжди E.164.
 *
 * Свідомо БЕЗ готової бібліотеки-компонента (react-phone-number-input та подібні):
 * вони приносять власний дропдаун і власний CSS, який довелося б перемальовувати під
 * HeroUI дорожче, ніж написати обгортку. З libphonenumber-js беремо тільки те, в чому
 * вона незамінна — метадані, форматування і валідацію (та сама ліба валідує в contracts,
 * тож фронт і бекенд не можуть розійтися в трактуванні «валідний номер»).
 */
export function FormPhoneField<T extends FieldValues>({
  control,
  name,
  label,
  countryValue,
  onCountryChange,
  placeholder,
  variant,
  isDisabled,
}: FormPhoneFieldProps<T>) {
  const { t } = useTranslation('common');
  const { field, fieldState } = useController({ control, name });

  // Ref на Prefix — єдина доступна зачіпка за геометрію поля: сам InputGroup ref не
  // пропускає (перезаписує власним), а Prefix — звичайний div. CountrySelect бере з
  // нього parentElement, щоб вирівняти дропдаун по всій ширині поля
  const prefixRef = useRef<HTMLDivElement>(null);

  const initial = stateFromE164(field.value, countryValue);
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [national, setNational] = useState(initial.national);
  // Показуємо підказку лише коли ввід реально впёрся в межу, і знімаємо її щойно
  // користувач почав стирати — щоб напис не «залипав» під полем
  const [isMaxLengthReached, setIsMaxLengthReached] = useState(false);

  // Значення, яке ми самі щойно віддали в RHF. Потрібне, щоб відрізнити зовнішню зміну
  // (reset/setValue при завантаженні даних на редагування) від власного вводу — інакше
  // ефект нижче перезаписував би те, що користувач друкує саме зараз
  const lastEmitted = useRef<string | null>(field.value ?? null);

  useEffect(() => {
    const value = (field.value as string | null) ?? null;
    if (value === lastEmitted.current) return;

    lastEmitted.current = value;
    const next = stateFromE164(value, countryValue);
    setCountry(next.country);
    setNational(next.national);
    setIsMaxLengthReached(false);
  }, [field.value, countryValue]);

  const emit = (nextNational: string, nextCountry: CountryCode) => {
    const e164 = toE164(nextNational, nextCountry);
    lastEmitted.current = e164;
    field.onChange(e164);
  };

  const applyCountry = (nextCountry: CountryCode) => {
    setCountry(nextCountry);
    onCountryChange?.(nextCountry);
    // Номер НЕ скидаємо — користувач міг просто помилитися країною; переформатовуємо
    // введені цифри під нову країну (і підрізаємо, якщо нова країна коротша)
    const reformatted = formatAsYouType(national, nextCountry, false);
    setNational(reformatted.value);
    setIsMaxLengthReached(reformatted.isMaxLengthReached);
    emit(reformatted.value, nextCountry);
  };

  const handleInput = (raw: string) => {
    const pasted = parsePastedInternational(raw);
    if (pasted) {
      setCountry(pasted.country);
      onCountryChange?.(pasted.country);
      setNational(pasted.national);
      setIsMaxLengthReached(false);
      emit(pasted.national, pasted.country);
      return;
    }

    const isDeletion = raw.length < national.length;
    const formatted = formatAsYouType(raw, country, isDeletion);
    setNational(formatted.value);
    setIsMaxLengthReached(formatted.isMaxLengthReached);
    emit(formatted.value, country);
  };

  return (
    <TextField isInvalid={fieldState.invalid} name={field.name}>
      <Label>{label}</Label>
      <InputGroup variant={variant}>
        {/* border-e-0 — прибирає вертикальний роздільник між селектом країни та
            інпутом: .input-group__prefix малює border-right завширшки
            --border-width-field (дзеркально до border-s-0 у FormPasswordField).
            pe-1 — проміжок до номера: типово префікс і інпут дають по px-3, тобто
            24px розриву між кодом країни та цифрами */}
        <InputGroup.Prefix ref={prefixRef} className="border-e-0 pe-1">
          <CountrySelect
            country={country}
            onCountryChange={applyCountry}
            prefixRef={prefixRef}
            isDisabled={isDisabled}
          />
        </InputGroup.Prefix>
        <InputGroup.Input
          // ps-1 — друга половина того ж проміжку (див. коментар до Prefix)
          className="ps-1"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          // Без явного placeholder показуємо приклад номера обраної країни — він і
          // слугує маскою, підказуючи і формат, і очікувану довжину
          placeholder={placeholder ?? getCountryHint(country)?.placeholder}
          disabled={isDisabled}
          value={national}
          onChange={(event) => {
            handleInput(event.target.value);
          }}
          onBlur={field.onBlur}
          ref={field.ref}
        />
      </InputGroup>
      {/* Не FieldError і не помилка форми: поле саме не дало ввести зайве, тож це
          пояснення, а не проблема, яку користувач має виправляти */}
      {isMaxLengthReached && !fieldState.error && (
        <p className="text-xs text-muted">{t('phone.maxLengthReached')}</p>
      )}
      <FieldError>{fieldState.error?.message}</FieldError>
    </TextField>
  );
}
