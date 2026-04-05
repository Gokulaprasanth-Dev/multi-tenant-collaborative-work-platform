/**
 * Unit tests for shared/circuit-breaker/index.ts
 *
 * Covers:
 * - createCircuitBreaker: wraps a function and fires successfully
 * - createCircuitBreaker: opens after threshold errors
 * - createCircuitBreaker: emits open/close/halfOpen lifecycle events
 * - createCircuitBreaker: options override defaults
 * - Named breakers (emailBreaker, searchBreaker, etc.) are callable
 */

// Mock prom-client Gauge before importing circuit-breaker
jest.mock('prom-client', () => ({
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
  })),
}));

import { createCircuitBreaker, emailBreaker, searchBreaker, razorpayBreaker, storageBreaker, samlBreaker } from '../../../src/shared/circuit-breaker';

describe('createCircuitBreaker', () => {
  it('fires the wrapped function and returns its result', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const breaker = createCircuitBreaker('test-ok', fn, {
      volumeThreshold: 1,
      errorThresholdPercentage: 50,
    });
    const result = await breaker.fire();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('rejects when the wrapped function throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const breaker = createCircuitBreaker('test-fail', fn, {
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
      timeout: 1000,
    });
    await expect(breaker.fire()).rejects.toThrow('boom');
  });

  it('opens circuit after exceeding error threshold', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const breaker = createCircuitBreaker('test-open', fn, {
      volumeThreshold: 2,
      errorThresholdPercentage: 50,
      resetTimeout: 100_000,
      timeout: 500,
    });

    const openHandler = jest.fn();
    breaker.on('open', openHandler);

    // Fire enough times to trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }

    expect(openHandler).toHaveBeenCalled();
    expect(breaker.opened).toBe(true);
  });

  it('emits halfOpen when reset timeout fires after opening', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const breaker = createCircuitBreaker('test-halfopen', fn, {
      volumeThreshold: 1,
      errorThresholdPercentage: 1,
      resetTimeout: 50, // very short for test
      timeout: 200,
    });

    const halfOpenHandler = jest.fn();
    breaker.on('halfOpen', halfOpenHandler);

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker.fire().catch(() => {});
    }

    // Wait for half-open probe
    await new Promise(r => setTimeout(r, 200));

    expect(halfOpenHandler).toHaveBeenCalled();
  });

  it('passes arguments to the wrapped function', async () => {
    const fn = jest.fn().mockImplementation(async (a: number, b: number) => a + b);
    const breaker = createCircuitBreaker<[number, number], number>('test-args', fn);
    const result = await breaker.fire(3, 4);
    expect(fn).toHaveBeenCalledWith(3, 4);
    expect(result).toBe(7);
  });
});

describe('Named breakers', () => {
  it('emailBreaker fires a thunk function', async () => {
    const thunk = jest.fn().mockResolvedValue(undefined);
    await expect(emailBreaker.fire(thunk)).resolves.toBeUndefined();
    expect(thunk).toHaveBeenCalled();
  });

  it('searchBreaker fires a thunk function', async () => {
    const thunk = jest.fn().mockResolvedValue('results');
    await expect(searchBreaker.fire(thunk)).resolves.toBe('results');
  });

  it('razorpayBreaker fires a thunk function', async () => {
    const thunk = jest.fn().mockResolvedValue({ id: 'order_123' });
    await expect(razorpayBreaker.fire(thunk)).resolves.toEqual({ id: 'order_123' });
  });

  it('storageBreaker fires a thunk function', async () => {
    const thunk = jest.fn().mockResolvedValue('s3-url');
    await expect(storageBreaker.fire(thunk)).resolves.toBe('s3-url');
  });

  it('samlBreaker fires a thunk function', async () => {
    const thunk = jest.fn().mockResolvedValue({ nameId: 'user@example.com' });
    await expect(samlBreaker.fire(thunk)).resolves.toEqual({ nameId: 'user@example.com' });
  });
});
