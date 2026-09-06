import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  getUiTheme,
  isUiThemeId,
  UI_THEMES,
  useUiTheme,
  type UiTheme,
} from '@saas-skeleton/ui/themes';

/**
 * Вибір ПАЛІТРИ — окремий контрол від `ThemeSwitcher` (світло/темрява) навмисно:
 * режим перемикають щодня і тому він живе в хедері, а палітру обирають раз, тож
 * їй місце в налаштуваннях. Злиті в один список, вони дали б N×2 пунктів меню.
 */
function ThemeSwatch({ theme }: { theme: UiTheme }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 overflow-hidden rounded-full border border-border"
    >
      {theme.swatch.map((color) => (
        <span key={color} className="flex-1" style={{ background: color }} />
      ))}
    </span>
  );
}

export function ThemeSelect() {
  const { t } = useTranslation('layout');
  const { theme, setTheme } = useUiTheme();
  const active = getUiTheme(theme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t('theme.paletteLabel')} size="sm" variant="outline" />}
      >
        <ThemeSwatch theme={active} />
        {t(active.labelKey)}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            // Значення радіогрупи Base UI нетипізоване — звіряємо з реєстром
            if (isUiThemeId(value)) {
              setTheme(value);
            }
          }}
        >
          {UI_THEMES.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.id}>
              <ThemeSwatch theme={item} />
              {t(item.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
