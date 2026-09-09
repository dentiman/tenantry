import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { DatePicker, type DatePickerProps } from '@saas-skeleton/ui/components/date-picker';
import type { DateValue } from '@saas-skeleton/ui/lib/date-value';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';

interface FormDateFieldProps<T extends FieldValues>
  extends Pick<
    DatePickerProps,
    'placeholder' | 'format' | 'min' | 'max' | 'weekStartsOn' | 'captionLayout' | 'disabled'
  > {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  /** Підказка під полем (FieldDescription) */
  description?: string;
  /** Горизонтальна розкладка — лейбл ліворуч від контрола */
  orientation?: 'vertical' | 'horizontal' | 'responsive';
  /**
   * Що записати у форму, коли поле очистили.
   *
   * Дефолт `null` — правильний для більшості схем: «дати немає» і «порожній
   * рядок» це різні стани, і саме `null` переживає JSON без сюрпризів. Але
   * форма може оголошувати поле простим `z.string()` (як форма події
   * календаря, де дата — один із трьох рядкових шматків часу), і тоді `null`
   * зламав би і тип, і повідомлення «обов'язкове». Розбіжність між контрактом
   * компонента і формою схеми живе ТУТ, у RHF-адаптері: сам `DatePicker`
   * лишається строго `DateValue | null`.
   */
  emptyValue?: DateValue | null;
}

/**
 * Той самий контракт, що `FormTextField`, але значення поля — цивільна дата
 * `yyyy-MM-dd` (рядок, не `Date`; чому саме так — `lib/date-value.ts`).
 *
 * Порожнє поле за замовчуванням дає `null` — див. `emptyValue`.
 */
export function FormDateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  orientation = 'vertical',
  emptyValue = null,
  ...pickerProps
}: FormDateFieldProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  return (
    <Field orientation={orientation} data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DatePicker
        id={id}
        name={field.name}
        value={field.value ?? null}
        onValueChange={(next) => {
          field.onChange(next ?? emptyValue);
        }}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid || undefined}
        {...pickerProps}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
