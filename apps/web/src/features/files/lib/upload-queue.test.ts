import { describe, expect, it } from 'vitest';
import { createUploadQueue, type UploadEntry, type UploadTransport } from './upload-queue';

interface Source {
  name: string;
  size: number;
}

/** Транспорт, кожен крок якого тест завершує вручну — так видно стан черги «посередині» */
function manualTransport() {
  interface Pending {
    name: string;
    resolve: () => void;
    reject: (error: Error) => void;
    progress: (loaded: number) => void;
  }
  const puts: Pending[] = [];
  const created: string[] = [];
  const transport: UploadTransport<Source, string> = {
    create: (source) => {
      created.push(source.name);
      return Promise.resolve({ id: `file-${source.name}`, uploadUrl: `put://${source.name}` });
    },
    put: (_url, source, { signal, onProgress }) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
        puts.push({
          name: source.name,
          resolve,
          reject,
          progress: (loaded) => {
            onProgress(loaded, source.size);
          },
        });
      }),
    complete: (id) => Promise.resolve(`ready:${id}`),
    describeError: (error) => (error instanceof Error ? error.message : 'unknown'),
  };
  const put = (name: string): Pending => {
    const pending = puts.findLast((p) => p.name === name);
    if (!pending) {
      throw new Error(`No transfer in flight for ${name}`);
    }
    return pending;
  };
  return { transport, put, created };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(concurrency = 3) {
  const io = manualTransport();
  let latest: readonly UploadEntry<Source, string>[] = [];
  let id = 0;
  const queue = createUploadQueue<Source, string>({
    transport: io.transport,
    concurrency,
    onChange: (entries) => {
      latest = entries;
    },
    newId: () => `u${String((id += 1))}`,
    now: () => 1000 + id,
  });
  const phases = (): Record<string, string> =>
    Object.fromEntries(latest.map((e) => [e.source.name, e.phase]));
  const file = (name: string, size = 100): Source => ({ name, size });
  return { queue, io, phases, file };
}

describe('upload queue', () => {
  it('transfers three files at a time and starts the next as one ends', async () => {
    const { queue, io, phases, file } = setup();
    const handles = ['a', 'b', 'c', 'd', 'e'].map((name) => queue.add(file(name)));
    await tick();

    expect(phases()).toEqual({
      a: 'transferring',
      b: 'transferring',
      c: 'transferring',
      d: 'queued',
      e: 'queued',
    });
    // Той, що чекає, ще нічого не надіслав — навіть запиту на створення
    expect(io.created).toEqual(['a', 'b', 'c']);

    io.put('b').resolve();
    await tick();

    expect(phases()).toMatchObject({ b: 'done', d: 'transferring', e: 'queued' });
    expect(await handles[1]?.done).toEqual({ status: 'done', result: 'ready:file-b' });
  });

  it('reports transfer progress and completes with the verified file', async () => {
    const { queue, io, file } = setup();
    const handle = queue.add(file('a', 200));
    await tick();

    io.put('a').progress(50);
    expect(queue.entries()[0]).toMatchObject({ phase: 'transferring', loaded: 50, total: 200 });

    io.put('a').resolve();
    expect(await handle.done).toEqual({ status: 'done', result: 'ready:file-a' });
    expect(queue.entries()[0]).toMatchObject({ phase: 'done', loaded: 200, result: 'ready:file-a' });
  });

  it('cancelling a transfer stops it without an error and frees the slot', async () => {
    const { queue, phases, file } = setup(1);
    const first = queue.add(file('a'));
    queue.add(file('b'));
    await tick();

    queue.cancel(first.id);
    await tick();

    expect(await first.done).toEqual({ status: 'canceled' });
    expect(phases()).toEqual({ a: 'canceled', b: 'transferring' });
    expect(queue.entries()[0]?.errorMessage).toBeUndefined();
  });

  it('cancelling a waiting upload sends nothing', async () => {
    const { queue, io, phases, file } = setup(1);
    queue.add(file('a'));
    const waiting = queue.add(file('b'));
    await tick();

    queue.cancel(waiting.id);
    io.put('a').resolve();
    await tick();

    expect(await waiting.done).toEqual({ status: 'canceled' });
    expect(phases()).toEqual({ a: 'done', b: 'canceled' });
    expect(io.created).toEqual(['a']);
  });

  it('a failed upload keeps its error and can be retried from the beginning', async () => {
    const { queue, io, file } = setup();
    const handle = queue.add(file('a'), { retryable: true });
    await tick();

    io.put('a').reject(new Error('Connection lost'));
    expect(await handle.done).toEqual({ status: 'failed', message: 'Connection lost' });
    expect(queue.entries()[0]).toMatchObject({
      phase: 'failed',
      failedPhase: 'transferring',
      errorMessage: 'Connection lost',
      retryable: true,
    });

    const retried = queue.retry(handle.id);
    await tick();
    // Повтор — з початку: новий запит на створення (новий presigned URL), той самий елемент
    expect(io.created).toEqual(['a', 'a']);
    expect(queue.entries()).toHaveLength(1);
    expect(queue.entries()[0]).toMatchObject({ id: handle.id, phase: 'transferring', loaded: 0 });

    io.put('a').resolve();
    expect(await retried?.done).toEqual({ status: 'done', result: 'ready:file-a' });
  });

  it('retry and remove only apply to uploads in a matching state', async () => {
    const { queue, file } = setup();
    const handle = queue.add(file('a'));
    await tick();

    expect(queue.retry(handle.id)).toBeUndefined();
    queue.remove(handle.id);
    expect(queue.entries()).toHaveLength(1);

    queue.cancel(handle.id);
    queue.remove(handle.id);
    expect(queue.entries()).toHaveLength(0);
  });

  it('a per-upload transport replaces the default one', async () => {
    const { queue, io, file } = setup();
    const other = manualTransport();
    const handle = queue.add(file('a'), { transport: other.transport });
    await tick();

    other.put('a').resolve();
    expect(await handle.done).toEqual({ status: 'done', result: 'ready:file-a' });
    expect(io.created).toEqual([]);
  });
});
