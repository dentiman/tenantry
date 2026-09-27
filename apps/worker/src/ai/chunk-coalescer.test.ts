import { describe, expect, it } from 'vitest';
import { ChunkCoalescer } from './chunk-coalescer';

describe('ChunkCoalescer', () => {
  it('коалесує: кадрів на виході менше, ніж на вході', () => {
    const coalescer = new ChunkCoalescer(1_000, 0);
    const frames = [];
    // 10 маленьких кадрів провайдера за 10 "мс" — жоден не дотягує до інтервалу 1000мс
    for (let i = 0; i < 10; i += 1) {
      const frame = coalescer.push('ab', i);
      if (frame) {
        frames.push(frame);
      }
    }
    const tail = coalescer.flush(10);
    if (tail) {
      frames.push(tail);
    }

    expect(frames.length).toBeLessThan(10);
    expect(frames).toHaveLength(1); // усе влізло в один хвіст
  });

  it('конкатенація відданих кадрів дорівнює накопиченому тексту', () => {
    const coalescer = new ChunkCoalescer(5, 0);
    const frames = [];
    let now = 0;
    for (const piece of ['ab', 'cd', 'ef', 'gh']) {
      now += 3;
      const frame = coalescer.push(piece, now);
      if (frame) {
        frames.push(frame);
      }
    }
    const tail = coalescer.flush(now + 1);
    if (tail) {
      frames.push(tail);
    }

    expect(frames.map((f) => f.text).join('')).toBe('abcdefgh');
    expect(frames.map((f) => f.text).join('')).toBe(coalescer.accumulatedText);
  });

  it('chunkCount дорівнює кількості ВЖЕ ВІДДАНИХ кадрів', () => {
    const coalescer = new ChunkCoalescer(0, 0); // flushIntervalMs=0 — флашить на кожному push
    expect(coalescer.chunkCount).toBe(0);

    coalescer.push('a', 1);
    expect(coalescer.chunkCount).toBe(1);

    coalescer.push('b', 2);
    expect(coalescer.chunkCount).toBe(2);
  });

  it('флашить на межі абзацу навіть якщо таймер ще не настав', () => {
    const coalescer = new ChunkCoalescer(10_000, 0);
    const frame = coalescer.push('some text\n\n', 1); // задовго до 10_000мс
    expect(frame).not.toBeNull();
    expect(frame?.text).toBe('some text\n\n');
  });

  it('chunkSeq монотонний, починається з 0', () => {
    const coalescer = new ChunkCoalescer(0, 0);
    const a = coalescer.push('a', 1);
    const b = coalescer.push('b', 2);
    expect(a?.chunkSeq).toBe(0);
    expect(b?.chunkSeq).toBe(1);
  });

  it('flush() на порожньому накопиченні повертає null, а не порожній кадр', () => {
    const coalescer = new ChunkCoalescer(1_000, 0);
    coalescer.push('exactly flushed', 2_000); // флашиться одразу (dueByTime)
    expect(coalescer.flush(2_001)).toBeNull();
  });
});
