import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getUsersFindAllQueryKey,
  useUsersCreate,
  useUsersFindAll,
  useUsersRemove,
} from '../api/generated/api';
import type { UsersFindAllParams } from '../api/generated/model';
import { useAuthStore } from '../stores/auth.store';

const LIMIT = 10;

export function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [newEmail, setNewEmail] = useState('');
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

  const createUser = useUsersCreate({
    mutation: {
      onSuccess: () => {
        setNewEmail('');
        void invalidateUsers();
      },
    },
  });
  const removeUser = useUsersRemove({
    mutation: { onSuccess: () => void invalidateUsers() },
  });

  const totalPages = data?.totalPages ?? 1;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newEmail) {
            createUser.mutate({ data: { email: newEmail } });
          }
        }}
      >
        <input
          type="email"
          placeholder="new-user@example.com"
          value={newEmail}
          onChange={(e) => {
            setNewEmail(e.target.value);
          }}
          className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={createUser.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add user
        </button>
        {createUser.isError && (
          <span className="self-center text-sm text-red-600">Failed (duplicate email?)</span>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.map((u) => (
              <tr key={u.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                <td className="px-4 py-3 text-gray-600">{u.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      u.role === 'ADMIN'
                        ? 'rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700'
                        : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600'
                    }
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">{u.isActive ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-gray-600">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => {
                        removeUser.mutate({ id: u.id });
                      }}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>
          Total: {data?.total ?? 0} · Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
