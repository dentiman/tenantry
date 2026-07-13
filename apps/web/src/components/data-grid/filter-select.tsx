import { ListBox, Select } from '@heroui/react';

interface FilterSelectProps {
  ariaLabel: string;
  allLabel: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (value: string | undefined) => void;
}

/** Селект-фільтр тулбара DataGrid: значення "all" ↔ undefined (немає фільтра в URL) */
export function FilterSelect({ ariaLabel, allLabel, value, options, onChange }: FilterSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      className="w-48"
      value={value ?? 'all'}
      onChange={(key) => {
        onChange(key === 'all' ? undefined : String(key));
      }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="all" textValue={allLabel}>
            {allLabel}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
