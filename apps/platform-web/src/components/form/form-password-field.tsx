import { Button, FieldError, InputGroup, Label, TextField } from '@heroui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a10.7 10.7 0 0 0 5.4-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

interface FormPasswordFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  autoComplete?: string;
  placeholder?: string;
  /** 'secondary' — для полів на однотонній поверхні (модалки), інакше поле зливається з фоном */
  variant?: 'primary' | 'secondary';
}

/** Те саме, що FormTextField, але з перемикачем видимості пароля (HeroUI InputGroup + Suffix-кнопка) */
export function FormPasswordField<T extends FieldValues>({
  control,
  name,
  label,
  autoComplete,
  placeholder,
  variant,
}: FormPasswordFieldProps<T>) {
  const { t } = useTranslation('common');
  const { field, fieldState } = useController({ control, name });
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField isInvalid={fieldState.invalid} name={field.name}>
      <Label>{label}</Label>
      <InputGroup fullWidth variant={variant}>
        <InputGroup.Input
          type={isVisible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
        />
        <InputGroup.Suffix className="pe-0">
          <Button
            isIconOnly
            aria-label={isVisible ? t('password.hide') : t('password.show')}
            size="sm"
            variant="ghost"
            onPress={() => {
              setIsVisible((prev) => !prev);
            }}
          >
            {isVisible ? <EyeSlashIcon /> : <EyeIcon />}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      <FieldError>{fieldState.error?.message}</FieldError>
    </TextField>
  );
}
