import { useEffect, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import {
  AlertDialog,
  Button,
  Chip,
  Input,
  Pagination,
  Spinner,
  Table,
  TextField,
} from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { getUsersFindAllQueryKey, useUsersFindAll, useUsersRemove } from '../api/generated/api';
import type { UsersFindAllParams } from '../api/generated/model';
import { useAuthStore } from '../stores/auth.store';
import { CreateUserModal } from '../components/create-user-modal';
import { pageItems } from '../lib/page-items';
import { formatDate } from '../lib/format';

const LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

const routeApi = getRouteApi('/app/users');

export function UsersPage() {
  const { t } = useTranslation(['users', 'common']);
  // Джерело правди для пошуку/сторінки — URL (?search=&page=)
  const { search = '', page = 1 } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [searchInput, setSearchInput] = useState(search);
  // Останнє значення, яке МИ поклали в URL — відрізняє наш navigate від back/forward
  const pushedSearchRef = useRef(search);
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // Debounce: URL (і запит до API) оновлюється після паузи у введенні
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        pushedSearchRef.current = searchInput;
        void navigate({
          search: { search: searchInput || undefined, page: undefined },
          replace: true,
        });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput, search, navigate]);

  // Зовнішня зміна URL (back/forward, вставлений лінк) — підтягуємо в інпут
  useEffect(() => {
    if (search !== pushedSearchRef.current) {
      pushedSearchRef.current = search;
      setSearchInput(search);
    }
  }, [search]);

  const goToPage = (target: number) => {
    void navigate({
      search: (prev) => ({ ...prev, page: target <= 1 ? undefined : target }),
    });
  };

  const params: UsersFindAllParams = {
    page,
    limit: LIMIT,
    ...(search ? { search } : {}),
  };
  const { data, isLoading } = useUsersFindAll(params);

  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });

  const removeUser = useUsersRemove({
    mutation: { onSuccess: () => void invalidateUsers() },
  });

  const totalPages = data?.totalPages ?? 1;
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <TextField aria-label={t('searchLabel')} className="w-64">
            <Input
              type="search"
              placeholder={t('searchPlaceholder')}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
              }}
            />
          </TextField>
          <CreateUserModal />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label={t('loadingLabel')} />
        </div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={t('table.ariaLabel')}>
              <Table.Header>
                <Table.Column isRowHeader>{t('table.email')}</Table.Column>
                <Table.Column>{t('table.name')}</Table.Column>
                <Table.Column>{t('table.role')}</Table.Column>
                <Table.Column>{t('table.active')}</Table.Column>
                <Table.Column>{t('table.created')}</Table.Column>
                <Table.Column aria-label={t('table.actions')}> </Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((u) => (
                  <Table.Row key={u.id} id={u.id}>
                    <Table.Cell className="font-medium text-foreground">{u.email}</Table.Cell>
                    <Table.Cell>{u.name ?? '—'}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={u.role === 'ADMIN' ? 'accent' : 'default'}>
                        {t(`roles.${u.role}`)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={u.isActive ? 'success' : 'danger'}>
                        {u.isActive ? t('status.active') : t('status.inactive')}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>{formatDate(u.createdAt)}</Table.Cell>
                    <Table.Cell className="text-right">
                      {u.id !== currentUser?.id && (
                        <AlertDialog>
                          <Button size="sm" variant="danger-soft">
                            {t('delete.button')}
                          </Button>
                          <AlertDialog.Backdrop>
                            <AlertDialog.Container>
                              <AlertDialog.Dialog className="sm:max-w-[400px]">
                                <AlertDialog.CloseTrigger />
                                <AlertDialog.Header>
                                  <AlertDialog.Icon status="danger" />
                                  <AlertDialog.Heading>{t('delete.heading')}</AlertDialog.Heading>
                                </AlertDialog.Header>
                                <AlertDialog.Body>
                                  <p>
                                    <Trans
                                      t={t}
                                      i18nKey="delete.body"
                                      values={{ email: u.email }}
                                      components={{ strong: <strong /> }}
                                    />
                                  </p>
                                </AlertDialog.Body>
                                <AlertDialog.Footer>
                                  <Button slot="close" variant="tertiary">
                                    {t('delete.cancel')}
                                  </Button>
                                  <Button
                                    slot="close"
                                    variant="danger"
                                    onPress={() => {
                                      removeUser.mutate({ id: u.id });
                                    }}
                                  >
                                    {t('delete.confirm')}
                                  </Button>
                                </AlertDialog.Footer>
                              </AlertDialog.Dialog>
                            </AlertDialog.Container>
                          </AlertDialog.Backdrop>
                        </AlertDialog>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {!isLoading && items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{t('empty')}</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          {t('common:pagination.summary', { total: data?.total ?? 0, page, totalPages })}
        </span>
        <Pagination>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={page <= 1}
                onPress={() => {
                  goToPage(page - 1);
                }}
              >
                <Pagination.PreviousIcon />
              </Pagination.Previous>
            </Pagination.Item>
            {pageItems(page, totalPages).map((item) =>
              typeof item === 'number' ? (
                <Pagination.Item key={item}>
                  <Pagination.Link
                    isActive={item === page}
                    onPress={() => {
                      goToPage(item);
                    }}
                  >
                    {item}
                  </Pagination.Link>
                </Pagination.Item>
              ) : (
                <Pagination.Item key={item}>
                  <Pagination.Ellipsis />
                </Pagination.Item>
              ),
            )}
            <Pagination.Item>
              <Pagination.Next
                isDisabled={page >= totalPages}
                onPress={() => {
                  goToPage(page + 1);
                }}
              >
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </div>
    </div>
  );
}
