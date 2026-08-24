import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface FormTextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  /** Підказка під полем (FieldDescription) — напр. правила формату */
  description?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}

/** Єдина точка інтеграції RHF ↔ Field/Input: значення, blur, ref, помилки */
export function FormTextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  type = 'text',
  autoComplete,
  placeholder,
}: FormTextFieldProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        name={field.name}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={fieldState.invalid || undefined}
        value={field.value ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        ref={field.ref}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
