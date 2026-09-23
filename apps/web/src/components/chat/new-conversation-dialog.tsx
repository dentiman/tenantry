import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { chatCreate, getChatFindAllQueryKey } from '../../api/generated/api';
import { UserMultiSelect } from '../user-multi-select/user-multi-select';

/**
 * Створення розмови. Мінімум із можливого: учасники і необовʼязкова назва —
 * саме той обсяг, який фаза CHAT-0.1 обіцяє (docs/chat.md §7.4). Керування
 * складом після створення приходить у `0.3`.
 */
export function NewConversationDialog() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setParticipants([]);
      setTitle('');
    }
  };

  const submit = async () => {
    if (participants.length === 0 || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      const conversation = await chatCreate({
        participantUserIds: participants,
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: getChatFindAllQueryKey() });
      close(false);
      await navigate({ to: '/chat/$conversationId', params: { conversationId: conversation.id } });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      {/* Головна дія area живе в хедері шела, поруч із крихтами — та сама
          форма, що `CreateCustomerModal` на `/customers`: суцільна кнопка
          `size="sm"`, іконка ЗА текстом. У колонці розмов її більше немає —
          там вона з'їдала рядок над пошуком і не давала фіду впертися в стінки */}
      <DialogTrigger
        render={
          <Button size="sm">
            {t('actions.newConversation')}
            <MessageSquarePlus />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newConversation.title')}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="chat-participants">
              {t('newConversation.participants')}
            </FieldLabel>
            <UserMultiSelect
              id="chat-participants"
              value={participants}
              onChange={setParticipants}
              placeholder={t('newConversation.participantsPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-title">{t('newConversation.name')}</FieldLabel>
            <Input
              id="chat-title"
              value={title}
              maxLength={120}
              placeholder={t('newConversation.namePlaceholder')}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">{t('actions.cancel')}</Button>} />
          <Button
            disabled={participants.length === 0 || isSubmitting}
            onClick={() => {
              void submit();
            }}
          >
            {t('actions.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
