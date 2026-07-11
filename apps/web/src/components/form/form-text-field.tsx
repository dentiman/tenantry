import { FieldError, Input, Label, TextField } from '@heroui/react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

interface FormTextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}

/** Єдина точка інтеграції RHF ↔ HeroUI TextField: значення, blur, ref, помилки */
export function FormTextField<T extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  placeholder,
}: FormTextFieldProps<T>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <TextField isInvalid={fieldState.invalid} name={field.name}>
      <Label>{label}</Label>
      <Input
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={field.value ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        ref={field.ref}
      />
      <FieldError>{fieldState.error?.message}</FieldError>
    </TextField>
  );
}
