import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { getChatTranscriptQueryKey, useChatPostTemplate } from '../../../api/generated/api';
import { randomUUID } from '../../../lib/uuid';
import {
  readLastTemplate,
  saveLastTemplate,
  TEMPLATE_LANGUAGE_PATTERN,
  TEMPLATE_NAME_PATTERN,
} from './whatsapp-helpers';

const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Надсилання схваленого шаблону за імʼям і мовою (CHAT-3a): поза 24-годинним вікном це єдине, що
 * приймає WhatsApp. Змінних шаблону ще немає — шаблон із параметрами провайдер відхилить, і причину
 * буде показано на повідомленні. `clientMessageId` генерується на відкритті діалогу: повторне
 * натискання «Send» після обриву мережі не створить другого повідомлення.
 */
export function TemplateDialog({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [last] = useState(() => readLastTemplate(browserStorage()));
  const [name, setName] = useState(last.name);
  const [language, setLanguage] = useState(last.language);
  const [clientMessageId, setClientMessageId] = useState(() => randomUUID());

  const post = useChatPostTemplate({
    mutation: {
      onSuccess: async (_, variables) => {
        saveLastTemplate(browserStorage(), { name: variables.data.name, language: variables.data.language });
        await queryClient.invalidateQueries({
          queryKey: getChatTranscriptQueryKey(conversationId),
        });
        setOpen(false);
        setClientMessageId(randomUUID());
      },
      onError: () => {
        toast.add({ type: 'error', title: t('template.failed') });
      },
    },
  });

  const valid = TEMPLATE_NAME_PATTERN.test(name) && TEMPLATE_LANGUAGE_PATTERN.test(language);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="xs" variant="outline">
            {t('template.send')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('template.title')}</DialogTitle>
          <DialogDescription>{t('template.description')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="tpl-name">{t('template.name')}</FieldLabel>
            <Input
              id="tpl-name"
              value={name}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value.trim());
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tpl-lang">{t('template.language')}</FieldLabel>
            <Input
              id="tpl-lang"
              value={language}
              autoComplete="off"
              onChange={(e) => {
                setLanguage(e.target.value.trim());
              }}
            />
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">{t('actions.cancel')}</Button>} />
          <Button
            disabled={!valid || post.isPending}
            onClick={() => {
              post.mutate({ id: conversationId, data: { name, language, clientMessageId } });
            }}
          >
            {t('template.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
