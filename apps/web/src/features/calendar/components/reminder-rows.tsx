import { useTranslation } from 'react-i18next';
import { BellIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Field, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';

/**
 * Пресети нагадувань (§17 доку). Значення — ХВИЛИНИ ДО початку: подію
 * переносять, і абсолютний момент довелося б перераховувати на кожен зсув.
 */
const PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 10_080] as const;

/** Максимум — 5 на подію (стеля контракту), більше не має практичного сенсу */
const MAX_REMINDERS = 5;

interface ReminderRowsProps {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

export function ReminderRows({ value, onChange, disabled }: ReminderRowsProps) {
  const { t } = useTranslation('calendar');

  const label = (minutes: number): string => {
    if (minutes === 0) return t('reminders.atStart');
    if (minutes % 10_080 === 0) return t('reminders.weeks', { count: minutes / 10_080 });
    if (minutes % 1440 === 0) return t('reminders.days', { count: minutes / 1440 });
    if (minutes % 60 === 0) return t('reminders.hours', { count: minutes / 60 });
    return t('reminders.minutes', { count: minutes });
  };

  return (
    <Field>
      <FieldLabel>{t('reminders.label')}</FieldLabel>
      <div className="flex flex-col gap-2">
        {value.map((minutes, index) => (
          <div key={`${String(minutes)}-${String(index)}`} className="flex items-center gap-2">
            <BellIcon className="size-4 shrink-0 text-muted-foreground" />
            <Select
              value={String(minutes)}
              onValueChange={(next: string | null) => {
                if (next === null) {
                  return;
                }
                const parsed = Number.parseInt(next, 10);
                onChange(value.map((item, position) => (position === index ? parsed : item)));
              }}
              disabled={disabled}
              items={PRESETS.map((preset) => ({
                value: String(preset),
                label: label(preset),
              }))}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* SelectGroup обовʼязковий у нашій композиції (як у FormSelect):
                    частини Base UI, що вимагають батька, падають у РАНТАЙМІ */}
                <SelectGroup>
                  {PRESETS.map((preset) => (
                    <SelectItem key={preset} value={String(preset)}>
                      {label(preset)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('reminders.remove')}
              disabled={disabled}
              onClick={() => {
                onChange(value.filter((_, position) => position !== index));
              }}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        {value.length < MAX_REMINDERS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() => {
              // Наступний пресет, якого ще немає: додавати другу копію «за 10 хв»
              // немає сенсу (та сама унікальність, що в БД)
              const next = PRESETS.find((preset) => !value.includes(preset)) ?? 10;
              onChange([...value, next]);
            }}
          >
            <PlusIcon />
            {t('reminders.add')}
          </Button>
        )}
      </div>
    </Field>
  );
}
