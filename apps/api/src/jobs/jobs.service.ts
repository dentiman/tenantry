import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@saas-skeleton/database';
import type { JobQuery, JobState } from '@saas-skeleton/contracts';

type JobSortBy = NonNullable<JobQuery['sortBy']>;

export interface JobRow {
  id: string;
  name: string;
  state: JobState;
  retry_count: number;
  retry_limit: number;
  singleton_key: string | null;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  data: unknown;
  output: unknown;
}

interface QueueStateRow {
  name: string;
  state: JobState;
  count: number;
}

const MISSING_TABLE = '42P01';

// Статичний whitelist: у SQL підставляється лише назва колонки з цього мапу,
// НІКОЛИ значення query-параметра напряму (raw SQL, немає параметризації для ідентифікаторів)
const JOB_SORT_COLUMNS: Record<JobSortBy, Prisma.Sql> = {
  name: Prisma.sql`name`,
  state: Prisma.sql`state`,
  createdAt: Prisma.sql`created_on`,
  startedAt: Prisma.sql`started_on`,
  completedAt: Prisma.sql`completed_on`,
};

/**
 * Read-only моніторинг черг: читає таблиці pg-boss напряму (raw SQL),
 * Prisma-схема їх не описує. Якщо схеми pgboss ще немає (pg-boss жодного
 * разу не стартував) — повертає порожні дані замість помилки.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: JobQuery): Promise<{
    items: JobRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, state, queue, sortBy, sortOrder } = query;

    const conditions: Prisma.Sql[] = [];
    if (state) {
      conditions.push(Prisma.sql`state = ${state}::pgboss.job_state`);
    }
    if (queue) {
      conditions.push(Prisma.sql`name = ${queue}`);
    }
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    // tie-breaker по id обов'язковий — інакше пагінація "пливе" при рівних значеннях sortBy
    const orderBy = sortBy
      ? Prisma.sql`ORDER BY ${JOB_SORT_COLUMNS[sortBy]} ${sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`}, id DESC`
      : Prisma.sql`ORDER BY created_on DESC, id DESC`;

    try {
      const [items, countRows] = await Promise.all([
        this.prisma.$queryRaw<JobRow[]>(Prisma.sql`
          SELECT id, name, state::text AS state, retry_count, retry_limit,
                 singleton_key, created_on, started_on, completed_on, data, output
          FROM pgboss.job
          ${where}
          ${orderBy}
          LIMIT ${limit} OFFSET ${(page - 1) * limit}
        `),
        this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
          SELECT count(*)::int AS count FROM pgboss.job ${where}
        `),
      ]);

      return { items, total: countRows[0]?.count ?? 0, page, limit };
    } catch (error) {
      if (this.isMissingPgBossSchema(error)) {
        return { items: [], total: 0, page, limit };
      }
      throw error;
    }
  }

  async queueStats(): Promise<QueueStateRow[]> {
    try {
      return await this.prisma.$queryRaw<QueueStateRow[]>(Prisma.sql`
        SELECT name, state::text AS state, count(*)::int AS count
        FROM pgboss.job
        GROUP BY name, state
        ORDER BY name
      `);
    } catch (error) {
      if (this.isMissingPgBossSchema(error)) {
        return [];
      }
      throw error;
    }
  }

  private isMissingPgBossSchema(error: unknown): boolean {
    // Prisma 7 + driver adapter: raw-помилка = P2010, оригінальний код Postgres
    // лежить у meta.driverAdapterError.cause.originalCode і дублюється в message
    const missing =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2010' &&
      error.message.includes(MISSING_TABLE);
    if (missing) {
      this.logger.warn('pgboss schema not found — returning empty monitoring data');
    }
    return missing;
  }
}
