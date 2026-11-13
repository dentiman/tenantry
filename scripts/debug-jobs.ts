/**
 * Джоби pg-boss однієї операції: «де застрягло» за trace-id (docs/observability.md §4).
 *
 *   pnpm debug:jobs <trace-id>     усі джоби ланцюга: черга, стан, спроби, помилка
 *   pnpm debug:jobs --failed       останні невдалі джоби й вміст dlq (без id)
 *
 * trace-id — `requestId` з відповіді API або `trace_id` з логу: він лежить у конверті джоби як
 * `correlationId`. Читає `pgboss.job` роллю control plane (`PLATFORM_DATABASE_URL`) — схема
 * pg-boss лежить поза RLS, і tenant-роль її не бачить. Лише читання.
 */
import '../libs/database/load-root-env';
import { parseArgs } from 'node:util';
import { Client } from 'pg';

const DEFAULT_PLATFORM_DATABASE_URL =
  'postgresql://saas_platform:saas_platform@localhost:5432/saas_skeleton';

interface JobRow {
  id: string;
  name: string;
  state: string;
  retry_count: number;
  retry_limit: number;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  message: string | null;
  message_id: string | null;
  causation_id: string | null;
  tenant_id: string | null;
  output: unknown;
}

const COLUMNS = `
  id, name, state::text AS state, retry_count, retry_limit, created_on, started_on, completed_on,
  data->>'name' AS message, data->>'messageId' AS message_id,
  data->>'causationId' AS causation_id, data->>'tenantId' AS tenant_id, output`;

function clock(date: Date | null): string {
  return date ? date.toISOString().slice(11, 23) : '—';
}

function outputSummary(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const { message, reason } = output as { message?: unknown; reason?: unknown };
  const text = typeof message === 'string' ? message : typeof reason === 'string' ? reason : undefined;
  return text ?? (Object.keys(output).length > 0 ? JSON.stringify(output).slice(0, 300) : undefined);
}

function printJob(job: JobRow): void {
  console.log(
    `${clock(job.created_on)} ${job.state.padEnd(9)} ${job.name}  ` +
      `спроб ${String(job.retry_count)}/${String(job.retry_limit)}  ` +
      `старт ${clock(job.started_on)} кінець ${clock(job.completed_on)}`,
  );
  console.log(
    `    job=${job.id} message=${job.message_id ?? '—'} causation=${job.causation_id ?? '—'}` +
      (job.tenant_id ? ` tenant=${job.tenant_id}` : ''),
  );
  const summary = job.state === 'completed' ? undefined : outputSummary(job.output);
  if (summary) console.log(`    ${summary}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { failed: { type: 'boolean', default: false }, limit: { type: 'string', default: '20' } },
  });
  const traceId = positionals[0]?.toLowerCase();
  if (!traceId && !values.failed) {
    console.error('Використання: pnpm debug:jobs <trace-id> | pnpm debug:jobs --failed [--limit 20]');
    process.exit(1);
  }

  // Дефолт — той самий, що в SystemPrismaService, і лише для слота 0: у слоті N адресу дає
  // `.env.local` від `pnpm ws:init`, підставляти порт слота 0 не можна (docs/workspace-slots.md)
  const slot = Number(process.env.WORKSPACE_SLOT ?? '0');
  const url =
    process.env.PLATFORM_DATABASE_URL ?? (slot === 0 ? DEFAULT_PLATFORM_DATABASE_URL : undefined);
  if (!url) {
    throw new Error('PLATFORM_DATABASE_URL не задано для цього слота — спершу `pnpm ws:init`');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = traceId
      ? await client.query<JobRow>(
          // dlq тримає вихідний конверт у data.data
          `SELECT ${COLUMNS} FROM pgboss.job
            WHERE data->>'correlationId' = $1 OR data->'data'->>'correlationId' = $1
            ORDER BY created_on, id`,
          [traceId],
        )
      : await client.query<JobRow>(
          `SELECT ${COLUMNS} FROM pgboss.job
            WHERE state = 'failed' OR name = 'dlq'
            ORDER BY created_on DESC, id LIMIT $1`,
          [Number(values.limit)],
        );
    for (const job of rows) printJob(job);
    console.error(`— ${String(rows.length)} джоб(а)`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
