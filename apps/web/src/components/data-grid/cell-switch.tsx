import { Switch } from '@heroui/react';

interface CellSwitchProps {
  /** Тумблер у клітинці не має видимої мітки — підпис приїжджає сюди */
  label: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (isSelected: boolean) => void;
}

/**
 * Тумблер із робочою інтеракцією.
 *
 * HeroUI v3.2.2 `Switch` (як і `Checkbox`) НЕ перемикається: розмітка коректна
 * (`<label>` + VisuallyHidden `<input role="switch">`), події миші доходять і не
 * скасовуються, але `change` не настає — ні від кліка, ні від Space на
 * сфокусованому input. Це не залежить від таблиці й відтворюється на сирому
 * `react-aria-components`. Діагноз і межі проблеми — `docs/frontend-ui-known-issues.md`.
 *
 * Тому: HeroUI-візуал у `inert`-обгортці (не потрапляє ні в таб-ордер, ні в
 * дерево доступності) + справжній нативний `input[role=switch]` поверх нього.
 * Клік і клавіатура дістаються input-у, стан малює візуал. Та сама конструкція,
 * що й у `SelectionCheckbox` — вона з'явилася раніше і з тієї ж причини.
 */
export function CellSwitch({ label, isSelected, isDisabled, onChange }: CellSwitchProps) {
  return (
    <span className="relative inline-flex rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
      <span inert>
        <Switch size="sm" isSelected={isSelected} isDisabled={isDisabled}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={isSelected}
        disabled={isDisabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}
