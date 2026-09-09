import { useState } from 'react';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  getUsersFindAllQueryKey,
  useUsersFindAll,
  useUsersRemove,
  useUsersSetStatus,
} from '../api/generated/api';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { useAuthStore } from '../stores/auth.store';
import { ChangeAvatarModal } from '../components/change-avatar-modal';
import { CreateUserModal } from '../components/create-user-modal';
import { ChangePasswordModal } from '../components/change-password-modal';
import { ActivityDrawer } from '../components/activity/activity-drawer';
import { PresenceDot } from '../components/presence-dot';
import { LastSeen } from '../components/last-seen';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { usePresence } from '../realtime/use-presence';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { PhoneNumber } from '../components/phone-number';
import type { UsersSearch } from '../router';
import { createDataGrid } from '@saas-skeleton/ui/components/data-grid';
import type {
  DataGridColumn,
  DataGridFilterDef,
  DataGridRowAction,
} from '@saas-skeleton/ui/components/data-grid';

// Типізований компаунд-набір гріда цієї сторінки; Grid.filter — фабрики фільтрів,
// привʼязані до search-схеми роуту /users
const Grid = createDataGrid<UsersSearch, UserListResponseDtoOutputItemsItem>();

/** Бізнес-фільтр статусу юзера: Active/Inactive ↔ isActive=true/false в URL і query API */
function userStatusFilter(t: TFunction<['users', 'common']>): DataGridFilterDef<UsersSearch> {
  return Grid.filter.select({
    key: 'isActive',
    ariaLabel: t('filters.statusLabel'),
    allLabel: t('filters.statusAll'),
    options: [
      { id: 'true', label: t('status.active') },
      { id: 'false', label: t('status.inactive') },
    ],
  });
}

export function UsersPage() {
  const { t } = useTranslation(['users', 'common']);
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  // Presence — окремий запит: він НЕ залежить від пагінації користувачів і не
  // інвалідується разом із нею (склад сторінки змінюється частіше за присутність)
  const presence = usePresence();
  // Юзер, якому міняємо аватар (демо файлової підсистеми); null — модалка закрита
  const [avatarUser, setAvatarUser] = useState<UserListResponseDtoOutputItemsItem | null>(null);
  // Юзер, чий фід активностей відкрито в драйвері; null — драйвер закрито
  const [activityUser, setActivityUser] = useState<UserListResponseDtoOutputItemsItem | null>(null);
  // Юзер, якому міняємо пароль; null — модалка закрита
  const [passwordUser, setPasswordUser] = useState<UserListResponseDtoOutputItemsItem | null>(null);

  const invalidateUsers = (): void => {
    void queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
  };

  const removeUser = useUsersRemove({
    mutation: { onSuccess: invalidateUsers },
  });

  const setStatus = useUsersSetStatus({
    mutation: {
      onSuccess: invalidateUsers,
      // 4xx тут не має «свого» поля у формі (тумблер — не форма), тому єдиний
      // чесний канал — тост; глобальний onError мовчить на 4xx за політикою
      onError: (error) => {
        toast.add({
          type: 'error',
          title: t('status.changeFailed'),
          description: parseApiError(error).message,
        });
      },
    },
  });

  /** Блокуємо саме той тумблер, який зараз летить на сервер, а не всю колонку */
  const isStatusPendingFor = (id: string): boolean =>
    setStatus.isPending && setStatus.variables.id === id;

  // Тулбар декларується так само, як columns: масив дефініцій
  const filters: DataGridFilterDef<UsersSearch>[] = [
    Grid.filter.search({ ariaLabel: t('searchLabel'), placeholder: t('searchPlaceholder') }),
    userStatusFilter(t),
  ];

  const columns: DataGridColumn<UserListResponseDtoOutputItemsItem>[] = [
    {
      // Одна колонка ідентичності замість трьох (аватар/email/ім'я): у гріді
      // це і є та сама сутність, а не три незалежні атрибути. Сортування —
      // за іменем (те, що читається першим рядком); email лишається в пошуку
      id: 'name',
      header: t('table.user'),
      isRowHeader: true,
      sortable: true,
      // max-w потрібен саме на клітинці: у table-layout:auto без нього колонка
      // розтягнеться під найдовший email і truncate ніколи не спрацює
      className: 'max-w-[18rem]',
      // Ідентичність — вхід у картку юзера: рядок таблиці дає перегляд, сторінка — деталі
      cell: (u) => (
        <Link
          to="/workspace/users/$userId"
          params={{ userId: u.id }}
          className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserIdentity
            email={u.email}
            name={u.name}
            avatarUrl={u.avatarUrl}
            badge={
              <PresenceDot
                isOnline={presence.isOnline(u.id)}
                isUnknown={presence.isUnknown}
                label={t('presence.online')}
              />
            }
          />
        </Link>
      ),
    },
    {
      id: 'phone',
      header: t('table.phone'),
      cell: (u) => <PhoneNumber value={u.phone} />,
    },
    {
      id: 'role',
      header: t('table.role'),
      sortable: true,
      cell: (u) => (
        <Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>{t(`roles.${u.role}`)}</Badge>
      ),
    },
    {
      id: 'isActive',
      header: t('table.active'),
      sortable: true,
      cell: (u) => (
        <Switch
          aria-label={u.isActive ? t('status.active') : t('status.inactive')}
          checked={u.isActive}
          // Себе вимкнути не можна (сервер відхилив би так само — тут лише UX);
          // під час запиту блокуємо ТІЛЬКИ той рядок, який перемикають
          disabled={u.id === currentUser?.id || isStatusPendingFor(u.id)}
          onCheckedChange={(isActive) => {
            setStatus.mutate({ id: u.id, data: { isActive } });
          }}
        />
      ),
    },
    {
      // Окрема колонка, а не другий рядок під іменем: `UserIdentity` спільний
      // із platform-web (libs/ui), а фіча — тільки в tenant-плані
      id: 'lastSeen',
      header: t('table.lastSeen'),
      // Не sortable: сортування вимагало б поля в UserQuerySchema та індексу
      // (tenant_id, last_seen_at) — окрема зміна, коли зʼявиться сценарій
      // «покажи неактивних понад N днів»
      cell: (u) => (
        <LastSeen
          isOnline={presence.isOnline(u.id)}
          isUnknown={presence.isUnknown}
          lastSeenAt={presence.lastSeenAt(u.id, u.lastSeenAt)}
        />
      ),
    },
    {
      id: 'createdAt',
      header: t('table.created'),
      sortable: true,
      cell: (u) => <DateTimeCell value={u.createdAt} />,
    },
  ];

  const rowActions: DataGridRowAction<UserListResponseDtoOutputItemsItem>[] = [
    {
      id: 'password',
      label: t('password.action'),
      onAction: (u) => {
        setPasswordUser(u);
      },
    },
    // Enable і Disable — два пункти з isVisible, а не один із динамічним label:
    // у меню видно рівно ту дію, яку рядок реально допускає
    {
      id: 'enable',
      label: t('status.enableAction'),
      isVisible: (u) => !u.isActive,
      isDisabled: (u) => u.id === currentUser?.id,
      onAction: (u) => {
        setStatus.mutate({ id: u.id, data: { isActive: true } });
      },
    },
    {
      id: 'disable',
      label: t('status.disableAction'),
      isVisible: (u) => u.isActive,
      isDisabled: (u) => u.id === currentUser?.id,
      onAction: (u) => {
        setStatus.mutate({ id: u.id, data: { isActive: false } });
      },
      // Підтвердження саме тут, а не на тумблері: у меню дія називається словом
      // і читається як рішення, тоді як тумблер — швидкий перемикач
      confirm: {
        heading: t('status.disableHeading'),
        // Без власного <p>: AlertDialogDescription сам рендерить абзац,
        // а <p> у <p> браузер розриває (React пише про це в консоль)
        body: (u) => (
          <Trans
            t={t}
            i18nKey="status.disableBody"
            values={{ email: u.email }}
            components={{ strong: <strong /> }}
          />
        ),
        confirmLabel: t('status.disableConfirm'),
        cancelLabel: t('status.disableCancel'),
      },
    },
    {
      id: 'activity',
      label: t('activity.action'),
      onAction: (u) => {
        setActivityUser(u);
      },
    },
    {
      id: 'avatar',
      label: t('avatar.action'),
      onAction: (u) => {
        setAvatarUser(u);
      },
    },
    {
      id: 'delete',
      label: t('delete.button'),
      isDanger: true,
      // Себе видалити не можна: пункт видно, але він неактивний
      isDisabled: (u) => u.id === currentUser?.id,
      onAction: (u) => {
        removeUser.mutate({ id: u.id });
      },
      confirm: {
        heading: t('delete.heading'),
        body: (u) => (
          <Trans
            t={t}
            i18nKey="delete.body"
            values={{ email: u.email }}
            components={{ strong: <strong /> }}
          />
        ),
        confirmLabel: t('delete.confirm'),
        cancelLabel: t('delete.cancel'),
      },
    },
  ];

  return (
    // limit не шлемо — дефолт задає бекенд (PaginationQuerySchema, 20)
    <Grid.Root
      useListQuery={(params, gridOptions) => useUsersFindAll(params, { query: gridOptions })}
      selection
    >
      {/* Ідентичність сторінки живе ТІЛЬКИ в хедері: заголовок і головна дія
          переїхали туди, а контент починається одразу з тулбара фільтрів —
          він належить таблиці, а не сторінці (див. PageHeader) */}
      <PageHeader
        label="UsersPage"
        breadcrumbs={[{ label: t('title') }]}
        subtitle={t('subtitle')}
        actions={<CreateUserModal />}
      />

      {/* Смуга на всю ширину, без відступів і скруглень: у режимі `bleed`
          тулбар — не плитка НАД полотном, а його верхня стрічка. Поля тримає
          сам `surface="band"`, тому обгортки з `px-6` тут немає.

          Лінія знизу — на ОБГОРТЦІ, а не на тулбарі: вона розділяє смугу і
          таблицю, тобто належить розкладці сторінки, а не компоненту фільтрів
          (той самий `border-border`, що й межі шела — вони мусять читатись як
          одна система ліній). Зверху лінії не малюємо: там уже стоїть `border-b`
          хедера, і друга дала б подвійну */}
      <div className="border-b border-border">
        <Grid.Toolbar
          surface="band"
          filters={filters}
          totalLabel={t('toolbar.total')}
          selectedLabel={t('toolbar.selected')}
          size="sm"
          selectionActions={() => (
            // Демонстраційний slot майбутніх bulk actions; свідомо disabled, доки
            // немає окремого batch endpoint і confirm-flow.
            <Button size="sm" disabled>
              {t('toolbar.bulkAction')}
            </Button>
          )}
        />
      </div>

      <Grid.Table
        ariaLabel={t('table.ariaLabel')}
        columns={columns}
        rowActions={rowActions}
        // Юзер без доступу лишається в списку (його треба бачити й повертати),
        // але не конкурує увагою з тими, хто працює
        isRowMuted={(u) => !u.isActive}
        surface="flush"
        messages={{ loading: t('loadingLabel'), empty: t('empty') }}
      />

      <ChangePasswordModal
        user={passwordUser}
        onClose={() => {
          setPasswordUser(null);
        }}
      />

      <ChangeAvatarModal
        user={avatarUser}
        onClose={() => {
          setAvatarUser(null);
        }}
      />

      <ActivityDrawer
        entityType="user"
        entityId={activityUser?.id ?? null}
        subtitle={activityUser?.email}
        onClose={() => {
          setActivityUser(null);
        }}
      />
    </Grid.Root>
  );
}
