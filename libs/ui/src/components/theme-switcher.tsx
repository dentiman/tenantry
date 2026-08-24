import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';

export function ThemeSwitcher() {
  const { t } = useTranslation('layout');
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t('theme.switchLabel')} size="icon-sm" variant="ghost" />}
      >
        {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              setTheme('light');
            }}
          >
            {t('theme.light')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setTheme('dark');
            }}
          >
            {t('theme.dark')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setTheme('system');
            }}
          >
            {t('theme.system')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
