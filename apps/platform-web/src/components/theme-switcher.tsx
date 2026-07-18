import { Button, Dropdown } from '@heroui/react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeSwitcher() {
  const { t } = useTranslation('layout');
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Dropdown>
      <Button aria-label={t('theme.switchLabel')} isIconOnly size="sm" variant="ghost">
        {resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          onAction={(key) => {
            setTheme(String(key));
          }}
        >
          <Dropdown.Item id="light" textValue={t('theme.light')}>
            {t('theme.light')}
          </Dropdown.Item>
          <Dropdown.Item id="dark" textValue={t('theme.dark')}>
            {t('theme.dark')}
          </Dropdown.Item>
          <Dropdown.Item id="system" textValue={t('theme.system')}>
            {t('theme.system')}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
