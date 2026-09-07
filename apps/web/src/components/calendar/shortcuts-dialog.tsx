import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Kbd, KbdGroup } from '@saas-skeleton/ui/components/ui/kbd';

/**
 * Довідка гарячих клавіш (`?`). Окремий екран, а не тултіпи на кнопках: клавіші
 * працюють без фокусу на чомусь конкретному, тож і показувати їх треба списком,
 * а не по одній там, куди людина навела мишу.
 *
 * Розкладка — джерело правди в `resolveHotkey`; тут вона ЛИШЕ описується. Тому
 * рядки перелічені руками: генерувати їх з мапи означало б показувати `d`/`w`
 * замість людських назв і однаково тримати другий словник для підписів.
 */
const ROWS: { id: string; keys: string[] }[] = [
  { id: 'today', keys: ['T'] },
  { id: 'day', keys: ['D'] },
  { id: 'week', keys: ['W'] },
  { id: 'month', keys: ['M'] },
  { id: 'agenda', keys: ['A'] },
  { id: 'previous', keys: ['←'] },
  { id: 'next', keys: ['→'] },
  { id: 'create', keys: ['N', 'C'] },
  { id: 'help', keys: ['?'] },
  { id: 'close', keys: ['Esc'] },
];

export function ShortcutsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation('calendar');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('hotkeys.title')}</DialogTitle>
          <DialogDescription>{t('hotkeys.hint')}</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2">
          {ROWS.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4">
              <dt className="text-sm">{t(`hotkeys.action.${row.id}`)}</dt>
              <dd>
                <KbdGroup>
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
