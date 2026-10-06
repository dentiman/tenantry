import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import type { AuthSessionResponse } from '@saas-skeleton/contracts';
import { ChangeOwnPasswordSchema } from '@saas-skeleton/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { formatRelativeTime } from '@saas-skeleton/ui/lib/format';
import {
  getAccountListSessionsQueryKey,
  useAccountChangePassword,
  useAccountListSessions,
  useAccountRevokeAllSessions,
  useAccountRevokeSession,
} from '../../../api/generated/api';
import { ContentSection } from '../../../components/section/content-section';
import { applyServerError, FormPasswordField } from '../../../components/form';
import { useAuthStore } from '../../auth/stores/auth.store';

interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Безпека акаунта. Дві дії, і обидві мають один побічний ефект: усі refresh-сесії
 * юзера відкликаються, а поточному пристрою сервер повертає СВІЖУ пару токенів —
 * її треба покласти в стор, інакше людина вилетіла б на /login за власну ж дію.
 */
export function UserSettingsSecurityPage() {
  const { t } = useTranslation('user-settings');

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('security.title') }]}
        subtitle={t('security.description')}
      />
      <div className="flex flex-col gap-8">
        <PasswordForm />
        <Separator />
        <SessionsSection />
      </div>
    </ContentSection>
  );
}

function PasswordForm() {
  const { t } = useTranslation('user-settings');
  const setTokens = useAuthStore((s) => s.setTokens);
  const changePassword = useAccountChangePassword();

  // Підтвердження живе ТІЛЬКИ у формі: серверу другий екземпляр рядка нічого не дає,
  // тому контракт про нього не знає — форма розширює його схему, а не підміняє
  const schema = useMemo(
    () =>
      ChangeOwnPasswordSchema.extend({ confirmPassword: z.string() }).refine(
        (values) => values.newPassword === values.confirmPassword,
        { path: ['confirmPassword'], message: t('security.password.mismatch') },
      ),
    [t],
  );

  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const tokens = await changePassword.mutateAsync({
        data: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      // Стара пара щойно померла разом з усіма іншими сесіями
      setTokens(tokens);
      reset();
      toast.add({ type: 'success', title: t('security.password.changed') });
    } catch (error) {
      // Невірний поточний пароль приїжджає полем currentPassword — стане під ним
      applyServerError(error, form);
    }
  });

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">{t('security.password.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('security.password.description')}</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
        <FieldGroup>
          <FormPasswordField
            control={control}
            name="currentPassword"
            label={t('security.password.current')}
            autoComplete="current-password"
          />
          <FormPasswordField
            control={control}
            name="newPassword"
            label={t('security.password.new')}
            autoComplete="new-password"
          />
          <FormPasswordField
            control={control}
            name="confirmPassword"
            label={t('security.password.confirm')}
            autoComplete="new-password"
          />
        </FieldGroup>

        {errors.root?.server && (
          <p className="text-sm text-destructive">{errors.root.server.message}</p>
        )}

        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('security.password.submitting') : t('security.password.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * «Мої пристрої» (AUTH-1). До появи `auth_sessions` цієї секції не існувало як
 * списку — і не тому, що бракувало UI: рядок refresh-токена жив до найближчої
 * ротації і щоразу отримував новий id, тож показувати й вибірково вбивати не було
 * чого. Тепер `id` сесії стабільний, і список — прямий наслідок моделі.
 *
 * Порожнього стану немає навмисно: щоб відкрити цю сторінку, треба мати сесію,
 * тож щонайменше один рядок у списку є завжди.
 */
function SessionsSection() {
  const { t } = useTranslation('user-settings');
  const queryClient = useQueryClient();
  const setTokens = useAuthStore((s) => s.setTokens);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  const [isRevokeAllOpen, setIsRevokeAllOpen] = useState(false);
  const [pendingSession, setPendingSession] = useState<AuthSessionResponse | null>(null);

  const sessions = useAccountListSessions();
  const revokeAll = useAccountRevokeAllSessions();
  const revokeOne = useAccountRevokeSession();

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: getAccountListSessionsQueryKey() });

  const onRevokeAll = async (): Promise<void> => {
    const tokens = await revokeAll.mutateAsync();
    // Стара пара щойно померла разом з усіма іншими сесіями
    setTokens(tokens);
    setIsRevokeAllOpen(false);
    await invalidate();
    toast.add({ type: 'success', title: t('security.sessions.done') });
  };

  const onRevokeOne = async (session: AuthSessionResponse): Promise<void> => {
    try {
      await revokeOne.mutateAsync({ id: session.id });
      setPendingSession(null);

      // Завершили СВІЙ же пристрій: сесії, з якої зроблено запит, більше немає,
      // і лишатись на сторінці з мертвим токеном немає сенсу
      if (session.isCurrent) {
        clearSession();
        void navigate({ to: '/login' });
        return;
      }

      await invalidate();
      toast.add({ type: 'success', title: t('security.sessions.revoked') });
    } catch {
      setPendingSession(null);
      toast.add({ type: 'error', title: t('security.sessions.revokeFailed') });
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">{t('security.sessions.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('security.sessions.description')}</p>
      </div>

      {sessions.isPending ? (
        <p className="text-sm text-muted-foreground">{t('security.sessions.loading')}</p>
      ) : (
        <ItemGroup className="gap-2">
          {(sessions.data ?? []).map((session) => (
            <Item key={session.id} variant="outline">
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">
                  {session.deviceLabel ?? t('security.sessions.unknownDevice')}
                  {session.isCurrent && (
                    <Badge variant="secondary">{t('security.sessions.thisDevice')}</Badge>
                  )}
                </ItemTitle>
                <ItemDescription>
                  {[session.ip, formatRelativeTime(session.lastUsedAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokeOne.isPending}
                  onClick={() => {
                    setPendingSession(session);
                  }}
                >
                  {t('security.sessions.revoke')}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}

      <p className="text-sm text-muted-foreground">{t('security.sessions.note')}</p>

      <div>
        <Button
          variant="secondary"
          disabled={revokeAll.isPending}
          onClick={() => {
            setIsRevokeAllOpen(true);
          }}
        >
          {t('security.sessions.signOutAll')}
        </Button>
      </div>

      <AlertDialog open={isRevokeAllOpen} onOpenChange={setIsRevokeAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('security.sessions.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('security.sessions.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('security.sessions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onRevokeAll();
              }}
            >
              {t('security.sessions.confirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingSession !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSession(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('security.sessions.revokeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSession?.isCurrent
                ? t('security.sessions.revokeCurrentBody')
                : t('security.sessions.revokeBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('security.sessions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSession) {
                  void onRevokeOne(pendingSession);
                }
              }}
            >
              {t('security.sessions.revoke')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
