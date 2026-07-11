import { Button, Card, FieldError, Input, Label, TextField } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { RegisterSchema, type Register } from '@saas-skeleton/contracts';
import { useAuthRegister } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const registerMutation = useAuthRegister();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Register>({ resolver: zodResolver(RegisterSchema) });

  const onSubmit = handleSubmit(async (values) => {
    const res = await registerMutation.mutateAsync({ data: values });
    setSession(res.user, res.tokens);
    await navigate({ to: '/' });
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">Create account</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <TextField isInvalid={Boolean(errors.name)}>
            <Label>Name</Label>
            <Input type="text" autoComplete="name" {...register('name')} />
            <FieldError>{errors.name?.message}</FieldError>
          </TextField>
          <TextField isInvalid={Boolean(errors.email)}>
            <Label>Email</Label>
            <Input type="email" autoComplete="email" {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </TextField>
          <TextField isInvalid={Boolean(errors.password)}>
            <Label>Password</Label>
            <Input type="password" autoComplete="new-password" {...register('password')} />
            <FieldError>{errors.password?.message}</FieldError>
          </TextField>
          {registerMutation.isError && (
            <p className="text-sm text-danger">Registration failed — email may already be taken</p>
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
