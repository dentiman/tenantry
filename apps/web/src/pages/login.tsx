import { Button, Card, FieldError, Input, Label, TextField } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { LoginSchema, type Login } from '@saas-skeleton/contracts';
import { useAuthLogin } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const login = useAuthLogin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Login>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    const res = await login.mutateAsync({ data: values });
    setSession(res.user, res.tokens);
    await navigate({ to: '/' });
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">Sign in</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <TextField isInvalid={Boolean(errors.email)}>
            <Label>Email</Label>
            <Input type="email" autoComplete="email" {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </TextField>
          <TextField isInvalid={Boolean(errors.password)}>
            <Label>Password</Label>
            <Input type="password" autoComplete="current-password" {...register('password')} />
            <FieldError>{errors.password?.message}</FieldError>
          </TextField>
          {login.isError && <p className="text-sm text-danger">Invalid email or password</p>}
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
