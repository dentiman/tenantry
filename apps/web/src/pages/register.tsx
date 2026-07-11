import { Button, Card } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { RegisterSchema, type Register } from '@saas-skeleton/contracts';
import { useAuthRegister } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { applyServerError, FormTextField } from '../components/form';

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const registerMutation = useAuthRegister();

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<Register>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { email: '', password: '', name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await registerMutation.mutateAsync({ data: values });
      setSession(res.user, res.tokens);
      await navigate({ to: '/' });
    } catch (error) {
      applyServerError(error, setError, {
        conflictField: 'email',
        conflictMessage: 'Email already registered',
      });
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">Create account</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <FormTextField control={control} name="name" label="Name" autoComplete="name" />
          <FormTextField control={control} name="email" label="Email" type="email" autoComplete="email" />
          <FormTextField
            control={control}
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
          />
          {errors.root?.server && (
            <p className="text-sm text-danger">{errors.root.server.message}</p>
          )}
          <Button type="submit" variant="primary" fullWidth isDisabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-link hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
