import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@saas-skeleton/ui/components/ui/input-group';

interface FormPasswordFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  /** Підказка під полем (FieldDescription) — напр. правила формату */
  description?: string;
  autoComplete?: string;
  placeholder?: string;
}

/** Те саме, що FormTextField, але з перемикачем видимості пароля (InputGroup + addon-кнопка) */
export function FormPasswordField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  autoComplete,
  placeholder,
}: FormPasswordFieldProps<T>) {
  const { t } = useTranslation('common');
  const id = useId();
  const { field, fieldState } = useController({ control, name });
  const [isVisible, setIsVisible] = useState(false);

  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={isVisible ? 'text' : 'password'}
          name={field.name}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={fieldState.invalid || undefined}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={isVisible ? t('password.hide') : t('password.show')}
            onClick={() => {
              setIsVisible((prev) => !prev);
            }}
          >
            {isVisible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
