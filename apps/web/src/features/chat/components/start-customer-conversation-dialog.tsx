import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus } from 'lucide-react';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { Alert, AlertDescription } from '@saas-skeleton/ui/components/ui/alert';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getChannelInboxListQueryKey,
  useChannelChannels,
  useChannelStartConversation,
} from '../../../api/generated/api';

/**
 * «Нова розмова з клієнтом» (CHAT-3a): агент пише першим з номера. Номер каналу береться зі списку
 * увімкнених; сервер знаходить контакт за номером, повертає його відкриту розмову або створює порожню,
 * а далі агент надсилає шаблон (композер сам покаже, що вікна немає).
 */
export function StartCustomerConversationDialog() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channels = useChannelChannels();
  const usable = (channels.data?.items ?? []).filter((channel) => channel.isEnabled);

  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [phoneError, setPhoneError] = useState(false);

  const selected =
    channelId ?? usable.find((channel) => channel.isDefault)?.id ?? usable[0]?.id ?? null;

  const start = useChannelStartConversation({
    mutation: {
      onSuccess: async (conversation) => {
        await queryClient.invalidateQueries({ queryKey: getChannelInboxListQueryKey() });
        setOpen(false);
        setPhone('');
        setName('');
        await navigate({
          to: '/chat/$conversationId',
          params: { conversationId: conversation.id },
        });
      },
      onError: (error) => {
        const parsed = parseApiError(error);
        if (parsed.fieldErrors.some((item) => item.field === 'phone')) {
          setPhoneError(true);
        } else {
          toast.add({ type: 'error', title: t('outreach.failed') });
        }
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="w-full">
            <MessageSquarePlus />
            {t('outreach.open')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('outreach.title')}</DialogTitle>
        </DialogHeader>
        {usable.length === 0 ? (
          <Alert>
            <AlertDescription>{t('outreach.noChannel')}</AlertDescription>
          </Alert>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>{t('outreach.channel')}</FieldLabel>
              <Select
                value={selected}
                items={usable.map((channel) => ({
                  value: channel.id,
                  label: channel.displayPhoneNumber ?? channel.id,
                }))}
                onValueChange={setChannelId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.displayPhoneNumber ?? channel.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-phone">{t('outreach.phone')}</FieldLabel>
              <Input
                id="oc-phone"
                type="tel"
                autoComplete="off"
                value={phone}
                aria-invalid={phoneError}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setPhoneError(false);
                }}
              />
              <FieldDescription>{t('outreach.phoneHint')}</FieldDescription>
              {phoneError && <FieldError>{t('outreach.invalidPhone')}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="oc-name">{t('outreach.name')}</FieldLabel>
              <Input
                id="oc-name"
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </Field>
          </FieldGroup>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">{t('actions.cancel')}</Button>} />
          <Button
            disabled={selected === null || phone.trim().length < 5 || start.isPending}
            onClick={() => {
              if (selected === null) return;
              start.mutate({
                data: {
                  channelId: selected,
                  phone: phone.trim(),
                  ...(name.trim() ? { name: name.trim() } : {}),
                },
              });
            }}
          >
            {t('outreach.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
