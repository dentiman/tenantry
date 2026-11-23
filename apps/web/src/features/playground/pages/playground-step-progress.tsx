import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { StepProgress, type StepProgressItem } from '@saas-skeleton/ui/components/step-progress';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import type { FileResponseDtoOutput } from '../../../api/generated/model/fileResponseDtoOutput';
import { uploadQueue, type FileUploadTransport } from '../../files/stores/upload.store';
import { ExampleTile, ShowcaseCard } from '../components/showcase';

/** Розмір, який «передає» фейковий транспорт: відсоток у лотку рахується за байтами */
const FAKE_SIZE = 4 * 1024 * 1024;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

/**
 * Транспорт без мережі й сховища: ті самі три етапи, але на таймерах. Черга справжня
 * (`uploadQueue`), тому ліміт одночасних передач, скасування, повтор і лоток у хедері
 * поводяться рівно як із реальними файлами.
 */
function fakeTransport(options: { durationMs: number; fail: boolean }): FileUploadTransport {
  // Падає лише ПЕРША спроба: повтор із лотка має дійти до кінця, інакше стенд не показав би,
  // що повтор узагалі працює
  let failuresLeft = options.fail ? 1 : 0;
  return {
    create: async (file, signal) => {
      await wait(300, signal);
      return { id: `fake-${file.name}`, uploadUrl: 'fake://upload' };
    },
    put: async (_url, _file, { signal, onProgress }) => {
      const ticks = 20;
      for (let tick = 1; tick <= ticks; tick += 1) {
        await wait(options.durationMs / ticks, signal);
        onProgress((FAKE_SIZE / ticks) * tick, FAKE_SIZE);
        if (failuresLeft > 0 && tick === ticks / 2) {
          failuresLeft -= 1;
          throw new Error('Simulated connection loss');
        }
      }
    },
    complete: async (id, signal) => {
      await wait(500, signal);
      // Стенд результат нікуди не привʼязує — файлу в сховищі немає
      return { id } as FileResponseDtoOutput;
    },
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
  };
}

let fakeCounter = 0;

function simulate(count: number, fail: boolean): void {
  for (let index = 0; index < count; index += 1) {
    fakeCounter += 1;
    const file = new File([new Uint8Array(FAKE_SIZE)], `demo-${String(fakeCounter)}.bin`);
    uploadQueue.add(file, {
      // Стенд — «рідний» споживач черги: результат нікому не обіцяно, тож повтор доречний
      retryable: true,
      // Перший файл партії падає на півдорозі, решта доходять
      transport: fakeTransport({ durationMs: 2500 + index * 700, fail: fail && index === 0 }),
    });
  }
}

/**
 * Каталожний стенд StepProgress — прогрес як список етапів — і лотка активності: кнопки
 * нижче наповнюють справжню чергу завантажень фейковими файлами, результат видно в хедері.
 */
export function PlaygroundStepProgressPage() {
  const { t } = useTranslation('playground');
  const [started, setStarted] = useState(0);

  const label = (key: 'prepare' | 'transfer' | 'verify' | 'report'): string =>
    t(`stepProgress.steps.${key}`);

  const running: StepProgressItem[] = [
    { key: 'prepare', label: label('prepare'), status: 'done' },
    { key: 'transfer', label: label('transfer'), status: 'running', current: 340, total: 1200 },
    { key: 'verify', label: label('verify'), status: 'pending' },
    { key: 'report', label: label('report'), status: 'pending' },
  ];
  const indeterminate: StepProgressItem[] = [
    { key: 'prepare', label: label('prepare'), status: 'done' },
    { key: 'transfer', label: label('transfer'), status: 'done' },
    { key: 'verify', label: label('verify'), status: 'running' },
  ];
  const failed: StepProgressItem[] = [
    { key: 'prepare', label: label('prepare'), status: 'done' },
    { key: 'transfer', label: label('transfer'), status: 'done' },
    {
      key: 'verify',
      label: label('verify'),
      status: 'failed',
      description: t('stepProgress.failedReason'),
    },
    { key: 'report', label: label('report'), status: 'pending' },
  ];
  const finished: StepProgressItem[] = [
    { key: 'prepare', label: label('prepare'), status: 'done' },
    { key: 'transfer', label: label('transfer'), status: 'done' },
    { key: 'verify', label: label('verify'), status: 'skipped' },
    { key: 'report', label: label('report'), status: 'done' },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.stepProgress') },
        ]}
      />

      <header className="mb-10 max-w-3xl">
        <Badge variant="secondary">{t('eyebrow')}</Badge>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('stepProgress.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {t('stepProgress.description')}
        </p>
      </header>

      <div className="min-w-0 space-y-6">
        <section className="rounded-xl border border-dashed border-border p-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('stepProgress.importLabel')}
          </p>
          <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
            import {'{ StepProgress }'} from '@saas-skeleton/ui/components/step-progress';
          </code>
        </section>

        <ShowcaseCard
          id="step-progress-states"
          title={t('stepProgress.sections.states.title')}
          description={t('stepProgress.sections.states.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ExampleTile code="running + current/total">
              <StepProgress steps={running} className="w-full" />
            </ExampleTile>
            <ExampleTile code="running" description={t('stepProgress.states.indeterminate')}>
              <StepProgress steps={indeterminate} className="w-full" />
            </ExampleTile>
            <ExampleTile code="failed + description">
              <StepProgress steps={failed} className="w-full" />
            </ExampleTile>
            <ExampleTile code="done · skipped">
              <StepProgress steps={finished} className="w-full" />
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="step-progress-tray"
          title={t('stepProgress.sections.tray.title')}
          description={t('stepProgress.sections.tray.description')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                simulate(5, false);
                setStarted((count) => count + 5);
              }}
            >
              {t('stepProgress.simulate.five')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                simulate(2, true);
                setStarted((count) => count + 2);
              }}
            >
              {t('stepProgress.simulate.failing')}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t('stepProgress.simulate.started', { count: started })}
            </span>
          </div>
        </ShowcaseCard>
      </div>
    </div>
  );
}
