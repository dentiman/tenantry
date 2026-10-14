import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { Alert, AlertDescription } from '@saas-skeleton/ui/components/ui/alert';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getMessagingSettingsListQueryKey,
  useMessagingSettingsConnect,
  useMessagingSettingsReauthenticate,
} from '../../../api/generated/api';
import { connectionFieldMessages, type FieldMessages } from './whatsapp-helpers';

interface Props {
  /** Без `accountId` — підключення нового акаунта; з ним — новий токен для наявного (WABA id вже відомий) */
  accountId?: string;
  trigger: ReactElement;
}

/**
 * Підключення WhatsApp Business / оновлення токена (CHAT-3a, chat/whatsapp-connection). Токен і секрет не
 * зберігаються в стані довше за відкритий діалог і ніколи не повертаються сервером. Вердикт провайдера
 * (поганий токен, немає доступу, бракує права) приходить `fieldErrors` і показується під потрібним полем.
 */
export function ConnectWhatsAppDialog({ accountId, trigger }: Props) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [errors, setErrors] = useState<FieldMessages['fields']>({});

  const reset = (): void => {
    setWabaId('');
    setAccessToken('');
    setAppId('');
    setAppSecret('');
    setErrors({});
  };

  const done = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: getMessagingSettingsListQueryKey() });
    toast.add({
      type: 'success',
      title: t(accountId ? 'settings.connect.updated' : 'settings.connect.connected'),
    });
    setOpen(false);
    reset();
  };
  const onError = (error: unknown): void => {
    const parsed = connectionFieldMessages(parseApiError(error));
    setErrors(parsed.fields);
    if (parsed.generic) {
      toast.add({ type: 'error', title: t('settings.connect.errors.generic') });
    }
  };

  const connect = useMessagingSettingsConnect({ mutation: { onSuccess: done, onError } });
  const reauth = useMessagingSettingsReauthenticate({ mutation: { onSuccess: done, onError } });
  const pending = connect.isPending || reauth.isPending;

  const hasApp = appId.trim() !== '' || appSecret.trim() !== '';
  const complete =
    accessToken.trim().length >= 20 &&
    (accountId !== undefined || wabaId.trim() !== '') &&
    (!hasApp || (appId.trim() !== '' && appSecret.trim() !== ''));

  const submit = (): void => {
    setErrors({});
    const app = hasApp ? { appId: appId.trim(), appSecret: appSecret.trim() } : {};
    if (accountId) {
      reauth.mutate({ id: accountId, data: { accessToken: accessToken.trim(), ...app } });
    } else {
      connect.mutate({
        data: {
          provider: 'meta_cloud',
          wabaId: wabaId.trim(),
          accessToken: accessToken.trim(),
          ...app,
        },
      });
    }
  };

  const error = (field: string): ReactElement | null => {
    const found = errors[field];
    return found ? <FieldError>{t(found.key, found.params)}</FieldError> : null;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(accountId ? 'settings.connect.updateTitle' : 'settings.connect.title')}
          </DialogTitle>
          <DialogDescription>{t('settings.connect.description')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {!accountId && (
            <Field>
              <FieldLabel htmlFor="wa-waba">{t('settings.connect.wabaId')}</FieldLabel>
              <Input
                id="wa-waba"
                inputMode="numeric"
                autoComplete="off"
                value={wabaId}
                onChange={(e) => {
                  setWabaId(e.target.value);
                }}
              />
              {error('wabaId')}
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="wa-token">{t('settings.connect.accessToken')}</FieldLabel>
            <Input
              id="wa-token"
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
              }}
            />
            <FieldDescription>{t('settings.connect.accessTokenHint')}</FieldDescription>
            {error('accessToken')}
          </Field>
          <Field>
            <FieldLabel htmlFor="wa-app-id">{t('settings.connect.appId')}</FieldLabel>
            <Input
              id="wa-app-id"
              inputMode="numeric"
              autoComplete="off"
              value={appId}
              onChange={(e) => {
                setAppId(e.target.value);
              }}
            />
            {error('appId')}
          </Field>
          <Field>
            <FieldLabel htmlFor="wa-app-secret">{t('settings.connect.appSecret')}</FieldLabel>
            <Input
              id="wa-app-secret"
              type="password"
              autoComplete="off"
              value={appSecret}
              onChange={(e) => {
                setAppSecret(e.target.value);
              }}
            />
            {error('appSecret')}
          </Field>
        </FieldGroup>
        {!hasApp && (
          <Alert>
            <AlertDescription>{t('settings.connect.unverifiedNote')}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">{t('actions.cancel')}</Button>} />
          <Button disabled={!complete || pending} onClick={submit}>
            {t(accountId ? 'settings.connect.save' : 'settings.connect.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
