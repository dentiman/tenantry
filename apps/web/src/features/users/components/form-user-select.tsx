import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { UserSelect } from './user-select';

interface FormUserSelectProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  allowUnassigned?: boolean;
}

/**
 * RHF ↔ `UserSelect`. Обгортка тонка навмисно: уся робота з юзерами (запит,
 * пошук, гідрація вибраного) живе в `UserSelect`, а тут лишається тільки
 * проводка поля — так той самий компонент годиться і поза формою (фільтр гріда
 * за `ownerId`, швидка зміна відповідального на картці).
 */
export function FormUserSelect<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  allowUnassigned,
}: FormUserSelectProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <UserSelect
        id={id}
        value={field.value ?? null}
        onChange={field.onChange}
        onBlur={field.onBlur}
        isInvalid={fieldState.invalid}
        placeholder={placeholder}
        allowUnassigned={allowUnassigned}
      />
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
