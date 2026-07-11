import { FieldError, Label, ListBox, Select } from '@heroui/react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

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

/** RHF ↔ HeroUI Select (single-select по рядковому ключу) */
export function FormSelect<T extends FieldValues>({
  control,
  name,
  label,
  options,
}: FormSelectProps<T>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <Select
      isInvalid={fieldState.invalid}
      name={field.name}
      value={field.value ?? null}
      onChange={field.onChange}
    >
      <Label>{label}</Label>
      <Select.Trigger onBlur={field.onBlur}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldError>{fieldState.error?.message}</FieldError>
    </Select>
  );
}
