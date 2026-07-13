import { Input, TextField } from '@heroui/react';

interface DataGridSearchFieldProps {
  ariaLabel: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Дамб-компонент тулбара DataGrid: value/onChange звичайні — page бере їх з grid.searchInput/grid.setSearchInput */
export function DataGridSearchField({
  ariaLabel,
  placeholder,
  value,
  onChange,
  className,
}: DataGridSearchFieldProps) {
  return (
    <TextField aria-label={ariaLabel} className={className ?? 'w-64'}>
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </TextField>
  );
}
