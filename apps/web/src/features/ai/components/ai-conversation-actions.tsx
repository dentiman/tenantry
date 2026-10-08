import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { useAiDeleteAllConversations, useAiReset } from '../../../api/generated/api';
import { invalidateAiConversations } from '../ai-queries';

type IconSize = 'icon' | 'icon-sm';

/**
 * Дії над розмовами, спільні для бічної панелі й сторінки асистента. `onDone` — що
 * робити ПІСЛЯ: панелі нічого, сторінці — перейти на поточну розмову, бо відкрита
 * могла щойно стати RETIRED або зникнути.
 */
export function AiNewConversationButton({
  size = 'icon',
  disabled,
  onDone,
}: {
  size?: IconSize;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const reset = useAiReset();

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label={t('newConversation')}
      title={t('newConversation')}
      disabled={reset.isPending || disabled}
      onClick={() => {
        reset.mutate(undefined, {
          onSettled: () => {
            void invalidateAiConversations(queryClient);
          },
          onSuccess: () => onDone?.(),
        });
      }}
    >
      <RotateCcwIcon />
    </Button>
  );
}

export function AiDeleteAllButton({ size = 'icon', onDone }: { size?: IconSize; onDone?: () => void }) {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const deleteAll = useAiDeleteAllConversations();
  const [isOpen, setIsOpen] = useState(false);

  const onConfirm = async (): Promise<void> => {
    await deleteAll.mutateAsync();
    setIsOpen(false);
    await invalidateAiConversations(queryClient);
    onDone?.();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={t('deleteAll.trigger')}
        title={t('deleteAll.trigger')}
        disabled={deleteAll.isPending}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <Trash2Icon />
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteAll.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteAll.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('deleteAll.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onConfirm();
              }}
            >
              {t('deleteAll.confirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
