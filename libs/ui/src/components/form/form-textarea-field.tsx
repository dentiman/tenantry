import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';

interface FormTextareaFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  placeholder?: string;
  rows?: number;
}

/** Той самий контракт, що FormTextField, але для багаторядкового тексту (нотатки) */
export function FormTextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  rows = 4,
}: FormTextareaFieldProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={field.name}
        rows={rows}
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
