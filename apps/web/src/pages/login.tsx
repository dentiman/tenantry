import { Button, Card } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { LoginSchema, type Login } from '@saas-skeleton/contracts';
import { useAuthLogin } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { FormTextField } from '../components/form';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const login = useAuthLogin();

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<Login>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await login.mutateAsync({ data: values });
      setSession(res.user, res.tokens);
      await navigate({ to: '/' });
    } catch {
      setError('root.server', { type: 'server', message: 'Invalid email or password' });
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">Sign in</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <FormTextField control={control} name="email" label="Email" type="email" autoComplete="email" />
          <FormTextField
            control={control}
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
          />
          {errors.root?.server && (
            <p className="text-sm text-danger">{errors.root.server.message}</p>
          )}
          <Button type="submit" variant="primary" fullWidth isDisabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          No account?{' '}
          <Link to="/register" className="font-medium text-link hover:underline">
            Register
          </Link>
        </p>
      </Card>
    </div>
  );
}
