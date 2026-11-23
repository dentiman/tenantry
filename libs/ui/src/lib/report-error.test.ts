import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError, setErrorReporter } from './report-error';

describe('reportError', () => {
  const restores: (() => void)[] = [];
  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
    vi.restoreAllMocks();
  });

  it('віддає звіт активному збирачу', () => {
    const reporter = vi.fn();
    restores.push(setErrorReporter(reporter));
    const error = new Error('boom');
    reportError({ error, source: 'route', context: { routeId: '/chat' } });
    expect(reporter).toHaveBeenCalledWith({
      error,
      source: 'route',
      context: { routeId: '/chat' },
    });
  });

  it('за замовчуванням пише в консоль із позначкою джерела', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');
    reportError({ error, source: 'lazy-boundary' });
    expect(spy).toHaveBeenCalledWith('[lazy-boundary]', error, '');
  });

  it('збій самого збирача не пробивається в UI', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    restores.push(
      setErrorReporter(() => {
        throw new Error('reporter down');
      }),
    );
    expect(() => {
      reportError({ error: new Error('x'), source: 'app' });
    }).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('функція скидання повертає попередній збирач', () => {
    const first = vi.fn();
    const second = vi.fn();
    restores.push(setErrorReporter(first));
    const restoreSecond = setErrorReporter(second);
    restoreSecond();
    reportError({ error: 1, source: 'app' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
