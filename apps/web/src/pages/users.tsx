import { useState } from 'react';
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
import { getUsersFindAllQueryKey, useUsersFindAll, useUsersRemove } from '../api/generated/api';
import type { UsersFindAllParams } from '../api/generated/model';
import { useAuthStore } from '../stores/auth.store';
import { CreateUserModal } from '../components/create-user-modal';

const LIMIT = 10;

type PageItem = number | 'ellipsis-left' | 'ellipsis-right';

// Вікно сторінок: 1 … (p-1, p, p+1) … total
function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: PageItem[] = [1];
  if (current > 3) {
    items.push('ellipsis-left');
  }
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    items.push(p);
  }
  if (current < total - 2) {
    items.push('ellipsis-right');
  }
  items.push(total);
  return items;
}

export function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

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
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <div className="flex items-center gap-2">
          <TextField aria-label="Search users" className="w-64">
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </TextField>
          <CreateUserModal />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading users" />
        </div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Users">
              <Table.Header>
                <Table.Column isRowHeader>Email</Table.Column>
                <Table.Column>Name</Table.Column>
                <Table.Column>Role</Table.Column>
                <Table.Column>Active</Table.Column>
                <Table.Column>Created</Table.Column>
                <Table.Column aria-label="Actions"> </Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((u) => (
                  <Table.Row key={u.id} id={u.id}>
                    <Table.Cell className="font-medium text-foreground">{u.email}</Table.Cell>
                    <Table.Cell>{u.name ?? '—'}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={u.role === 'ADMIN' ? 'accent' : 'default'}>
                        {u.role}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={u.isActive ? 'success' : 'danger'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>{new Date(u.createdAt).toLocaleDateString()}</Table.Cell>
                    <Table.Cell className="text-right">
                      {u.id !== currentUser?.id && (
                        <AlertDialog>
                          <Button size="sm" variant="danger-soft">
                            Delete
                          </Button>
                          <AlertDialog.Backdrop>
                            <AlertDialog.Container>
                              <AlertDialog.Dialog className="sm:max-w-[400px]">
                                <AlertDialog.CloseTrigger />
                                <AlertDialog.Header>
                                  <AlertDialog.Icon status="danger" />
                                  <AlertDialog.Heading>Delete user?</AlertDialog.Heading>
                                </AlertDialog.Header>
                                <AlertDialog.Body>
                                  <p>
                                    This will permanently delete <strong>{u.email}</strong>. This
                                    action cannot be undone.
                                  </p>
                                </AlertDialog.Body>
                                <AlertDialog.Footer>
                                  <Button slot="close" variant="tertiary">
                                    Cancel
                                  </Button>
                                  <Button
                                    slot="close"
                                    variant="danger"
                                    onPress={() => {
                                      removeUser.mutate({ id: u.id });
                                    }}
                                  >
                                    Delete
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
        <p className="py-6 text-center text-sm text-muted">No users found</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          Total: {data?.total ?? 0} · Page {page} of {totalPages}
        </span>
        <Pagination>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={page <= 1}
                onPress={() => {
                  setPage((p) => p - 1);
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
                      setPage(item);
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
                  setPage((p) => p + 1);
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
