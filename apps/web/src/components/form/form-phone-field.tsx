import type { CountryCode } from 'libphonenumber-js';
import { useEffect, useId, useRef, useState } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@saas-skeleton/ui/components/ui/input-group';
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
  isDisabled?: boolean;
}

/**
 * Телефонне поле: вибір країни + національний номер, назовні — завжди E.164.
 *
 * Свідомо БЕЗ готової бібліотеки-компонента (react-phone-number-input та подібні):
 * вони приносять власний дропдаун і власний CSS, який довелося б перемальовувати під
 * нашу тему дорожче, ніж написати обгортку. З libphonenumber-js беремо тільки те, в чому
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
  isDisabled,
}: FormPhoneFieldProps<T>) {
  const { t } = useTranslation('common');
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  // Ref на сам InputGroup — якір попапа вибору країни (ширину віддає Base UI
  // змінною --anchor-width, міряти нічого не треба)
  const groupRef = useRef<HTMLDivElement>(null);

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
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup ref={groupRef}>
        <InputGroupAddon align="inline-start">
          <CountrySelect
            country={country}
            onCountryChange={applyCountry}
            anchorRef={groupRef}
            isDisabled={isDisabled}
          />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          // Без явного placeholder показуємо приклад номера обраної країни — він і
          // слугує маскою, підказуючи і формат, і очікувану довжину
          placeholder={placeholder ?? getCountryHint(country)?.placeholder}
          disabled={isDisabled}
          aria-invalid={fieldState.invalid || undefined}
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
        <FieldDescription>{t('phone.maxLengthReached')}</FieldDescription>
      )}
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
