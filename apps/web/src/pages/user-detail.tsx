import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { TriangleAlert } from 'lucide-react';
import {
  getUsersFindAllQueryKey,
  getUsersFindOneQueryKey,
  useUsersFindOne,
  useUsersRemove,
  useUsersSetStatus,
} from '../api/generated/api';
import { ActivityPanel } from '../components/activity/activity-panel';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { ChangeAvatarModal } from '../components/change-avatar-modal';
import { ChangePasswordModal } from '../components/change-password-modal';
import { PresenceDot } from '../components/presence-dot';
import { LastSeen } from '../components/last-seen';
import { CountryFlag } from '../components/form/phone/country-flag';
import { isSupportedCountry } from '../components/form/phone/countries';
import { formatForDisplay } from '../components/form/phone/phone-format';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';
import { usePresence } from '../realtime/use-presence';
import { useAuthStore } from '../stores/auth.store';

/** Рядок «підпис → значення» у картках: одна форма на всі три групи */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Сторінка юзера. Розкладка — стандартний detail-screen: шапка з ідентичністю,
 * статусами і діями, під нею дві колонки (вкладки з деталями/стрічкою + вузька
 * колонка стану). Вкладки, а не довгий скрол: стрічка активності росте, і не має
 * відпихати контакти вниз.
 *
 * Усі дії — ті самі мутації, що в гріді (`/users`), включно з правилом «не собі»:
 * власний акаунт не можна ні вимкнути, ні видалити.
 */
export function UserDetailPage() {
  const { t } = useTranslation(['users', 'common']);
  const { userId } = useParams({ from: '/app/users/$userId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const presence = usePresence();

  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'delete' | null>(null);

  const { data: user, isLoading, isError } = useUsersFindOne(userId);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getUsersFindOneQueryKey(userId) });
  };

  const setStatus = useUsersSetStatus({ mutation: { onSuccess: invalidate } });
  const removeUser = useUsersRemove({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
        void navigate({ to: '/users' });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={t('loadingLabel')} />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('detail.notFound')}</EmptyTitle>
          <EmptyDescription>{t('detail.notFoundHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const isSelf = user.id === currentUser?.id;
  const phone = formatForDisplay(user.phone);

  return (
    <div className="flex flex-col gap-6">
      {/* Крихти живуть у хедері layout-а — сторінка віддає їх через портал */}
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/users' }, { label: user.name ?? user.email }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <UserIdentity
            email={user.email}
            name={user.name}
            avatarUrl={user.avatarUrl}
            size="lg"
            badge={
              <PresenceDot
                isOnline={presence.isOnline(user.id)}
                isUnknown={presence.isUnknown}
                label={t('presence.online')}
              />
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
              {t(`roles.${user.role}`)}
            </Badge>
            <Badge variant={user.isActive ? 'success' : 'destructive'}>
              {user.isActive ? t('status.active') : t('status.inactive')}
            </Badge>
            {isSelf && <Badge variant="outline">{t('detail.you')}</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setIsPasswordOpen(true);
            }}
          >
            {t('password.action')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIsAvatarOpen(true);
            }}
          >
            {t('avatar.action')}
          </Button>
          {user.isActive ? (
            <Button
              variant="secondary"
              disabled={isSelf}
              onClick={() => {
                setConfirm('disable');
              }}
            >
              {t('status.disableAction')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setStatus.mutate({ id: user.id, data: { isActive: true } });
              }}
            >
              {t('status.enableAction')}
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={isSelf}
            onClick={() => {
              setConfirm('delete');
            }}
          >
            {t('delete.button')}
          </Button>
        </div>
      </div>

      {/* Дві колонки: зліва дані, справа — постійна стрічка подій. Вкладок більше
          немає: після переїзду Activity у колонку в них лишався б один розділ */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.state.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Fact label={t('detail.state.presence')}>
                {/* Замість голого «Offline» — коли саме юзер був тут востаннє:
                    сам по собі факт «не онлайн» майже нічого не повідомляє.
                    Статус АКАУНТА — сусідній рядок, плутати їх не можна */}
                <LastSeen
                  isOnline={presence.isOnline(user.id)}
                  isUnknown={presence.isUnknown}
                  lastSeenAt={presence.lastSeenAt(user.id, user.lastSeenAt)}
                />
              </Fact>
              <Separator />
              <Fact label={t('detail.state.memberSince')}>{formatDate(user.createdAt)}</Fact>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('detail.contact.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Fact label={t('detail.contact.email')}>{user.email}</Fact>
              <Separator />
              <Fact label={t('detail.contact.phone')}>
                {phone ? (
                  <span className="flex items-center justify-end gap-2 tabular-nums">
                    {isSupportedCountry(user.phoneCountry) && (
                      <CountryFlag country={user.phoneCountry} />
                    )}
                    {phone}
                  </span>
                ) : (
                  t('detail.contact.empty')
                )}
              </Fact>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('detail.account.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Fact label={t('detail.account.role')}>{t(`roles.${user.role}`)}</Fact>
              <Separator />
              <Fact label={t('detail.account.status')}>
                {user.isActive ? t('status.active') : t('status.inactive')}
              </Fact>
              <Separator />
              <Fact label={t('detail.account.locale')}>{user.locale}</Fact>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('detail.avatarCard.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              <UserIdentity
                email={user.email}
                name={user.name}
                avatarUrl={user.avatarUrl}
                size="lg"
                textClassName="hidden"
              />
              {!user.avatarUrl && (
                <p className="text-sm text-muted-foreground">{t('detail.avatarCard.empty')}</p>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsAvatarOpen(true);
                }}
              >
                {t('avatar.action')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('detail.meta.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Fact label={t('detail.meta.created')}>{formatDateTime(user.createdAt)}</Fact>
              <Separator />
              <Fact label={t('detail.meta.updated')}>{formatDateTime(user.updatedAt)}</Fact>
              <Separator />
              <Fact label={t('detail.meta.id')}>
                <code className="font-mono text-xs break-all">{user.id}</code>
              </Fact>
            </CardContent>
          </Card>
        </div>

        {/* Той самий компонент, що на картці кастомера — стрічка одна */}
        <ActivityPanel entityType="user" entityId={user.id} />
      </div>

      <ChangePasswordModal
        user={isPasswordOpen ? user : null}
        onClose={() => {
          setIsPasswordOpen(false);
        }}
      />
      <ChangeAvatarModal
        user={isAvatarOpen ? user : null}
        onClose={() => {
          setIsAvatarOpen(false);
        }}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {confirm === 'delete' ? t('delete.heading') : t('status.disableHeading')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey={confirm === 'delete' ? 'delete.body' : 'status.disableBody'}
                values={{ email: user.email }}
                components={{ strong: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {confirm === 'delete' ? t('delete.cancel') : t('status.disableCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm === 'delete') {
                  removeUser.mutate({ id: user.id });
                } else {
                  setStatus.mutate({ id: user.id, data: { isActive: false } });
                }
                setConfirm(null);
              }}
            >
              {confirm === 'delete' ? t('delete.confirm') : t('status.disableConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
