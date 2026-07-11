import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CreateUserSchema, type CreateUser } from '@saas-skeleton/contracts';
import { getUsersFindAllQueryKey, useUsersCreate } from '../api/generated/api';
import { applyServerError, FormSelect, FormTextField } from './form';

const roleOptions = [
  { id: 'USER', label: 'User' },
  { id: 'ADMIN', label: 'Admin' },
];

export function CreateUserModal() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const createUser = useUsersCreate();

  const {
    control,
    handleSubmit,
    setError,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<CreateUser>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { email: '', name: '', role: 'USER', password: '' },
  });

  const close = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      reset();
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createUser.mutateAsync({
        data: { ...values, name: values.name?.trim() ? values.name.trim() : null },
      });
      await queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
      close(false);
    } catch (error) {
      applyServerError(error, setError, {
        conflictField: 'email',
        conflictMessage: 'Email already registered',
      });
    }
  });

  return (
    <Modal isOpen={isOpen} onOpenChange={close}>
      <Button variant="primary">Add user</Button>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Add user</Modal.Heading>
            </Modal.Header>
            <form onSubmit={(e) => void onSubmit(e)} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <FormTextField
                  control={control}
                  name="email"
                  label="Email"
                  type="email"
                  placeholder="user@example.com"
                  variant="secondary"
                />
                <FormTextField
                  control={control}
                  name="name"
                  label="Name"
                  placeholder="Optional"
                  variant="secondary"
                />
                <FormSelect
                  control={control}
                  name="role"
                  label="Role"
                  options={roleOptions}
                  variant="secondary"
                />
                <FormTextField
                  control={control}
                  name="password"
                  label="Initial password"
                  type="password"
                  autoComplete="new-password"
                  variant="secondary"
                />
                {errors.root?.server && (
                  <p className="text-sm text-danger">{errors.root.server.message}</p>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" isDisabled={isSubmitting}>
                  {isSubmitting ? 'Creating…' : 'Create user'}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
