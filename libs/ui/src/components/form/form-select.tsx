import { useId } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';

export interface FormSelectOption {
  id: string;
  label: string;
}

interface FormSelectProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: FormSelectOption[];
}

/**
 * RHF ↔ Select (single-select по рядковому ключу).
 *
 * `items` передається в `Select` навмисно: без цієї мапи `SelectValue` малює в
 * тригері СИРЕ значення (`USER`), а не підпис (`User`) — Base UI не читає його з
 * `children` елемента списку. Тригер розтягується на всю ширину (у реєстрі він
 * `w-fit`) — поле у формі має поводитись як решта полів.
 */
export function FormSelect<T extends FieldValues>({
  control,
  name,
  label,
  options,
}: FormSelectProps<T>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options.map((option) => ({ value: option.id, label: option.label }))}
        name={field.name}
        value={field.value ?? null}
        onValueChange={field.onChange}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={fieldState.invalid || undefined}
          onBlur={field.onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  );
}
