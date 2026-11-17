import type { ReactNode } from 'react';
import { CheckIcon, MinusIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@saas-skeleton/ui/components/ui/progress';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Стан кроку — єдиний фіксований enum моделі (docs/user-operations.md §4). Самі кроки
 * динамічні: їх набір задає джерело (завантаження файлу, згодом серверна операція).
 * З появою серверної моделі (uo-2) тип переїде в `libs/contracts`, а цей файл його імпортує.
 */
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StepProgressItem {
  key: string;
  /** Уже перекладений підпис: пакет не знає неймспейсів застосунку (ui-stack.md §2) */
  label: ReactNode;
  status: StepStatus;
  /** Вимірюваний прогрес кроку; смужка показується лише для `running` з обома числами */
  current?: number | undefined;
  total?: number | undefined;
  /** Другий рядок: причина помилки, уточнення */
  description?: ReactNode;
}

interface StepProgressProps {
  steps: readonly StepProgressItem[];
  className?: string;
}

/**
 * Прогрес як список етапів: перший виконано, другий виконується, решта чекають. Чисте
 * відображення — звідки взялась модель, компонент не знає (клієнтська черга завантажень чи
 * `UserOperation` із сервера дають ту саму форму).
 *
 * Стан кроку видно не лише кольором: у кожного свій значок, а словами він названий у
 * прихованому тексті для екранного читача; поточний крок позначено `aria-current="step"`.
 */
export function StepProgress({ steps, className }: StepProgressProps) {
  const { t } = useTranslation('common');

  return (
    <ol data-slot="step-progress" className={cn('flex flex-col gap-2', className)}>
      {steps.map((step) => {
        const hasBar =
          step.status === 'running' &&
          step.current !== undefined &&
          step.total !== undefined &&
          step.total > 0;
        return (
          <li
            key={step.key}
            data-status={step.status}
            aria-current={step.status === 'running' ? 'step' : undefined}
            className="flex gap-2.5 text-sm"
          >
            <StepMarker status={step.status} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'leading-5',
                  step.status === 'pending' || step.status === 'skipped'
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                  step.status === 'running' && 'font-medium',
                )}
              >
                {step.label}
                <span className="sr-only"> — {t(`steps.status.${step.status}`)}</span>
              </p>
              {step.description ? (
                <p
                  className={cn(
                    'mt-0.5 text-xs',
                    step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {step.description}
                </p>
              ) : null}
              {hasBar ? (
                <Progress
                  className="mt-1.5"
                  value={step.current ?? 0}
                  max={step.total ?? 100}
                  aria-label={t('steps.progress')}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Значок 20×20 в одну лінію з першим рядком підпису; кольори — шкала іконок, не тексту */
function StepMarker({ status }: { status: StepStatus }) {
  const frame = 'flex size-5 shrink-0 items-center justify-center rounded-full';
  switch (status) {
    case 'done':
      return (
        <span aria-hidden className={cn(frame, 'bg-primary text-primary-foreground')}>
          <CheckIcon className="size-3" />
        </span>
      );
    case 'running':
      return (
        <span aria-hidden className={cn(frame, 'text-icon-strong')}>
          <Spinner aria-hidden role="presentation" className="size-4" />
        </span>
      );
    case 'failed':
      return (
        <span aria-hidden className={cn(frame, 'bg-destructive text-destructive-foreground')}>
          <XIcon className="size-3" />
        </span>
      );
    case 'skipped':
      return (
        <span aria-hidden className={cn(frame, 'text-icon-muted')}>
          <MinusIcon className="size-3.5" />
        </span>
      );
    case 'pending':
      return (
        <span aria-hidden className={frame}>
          <span className="size-2 rounded-full border border-icon-muted" />
        </span>
      );
  }
}
