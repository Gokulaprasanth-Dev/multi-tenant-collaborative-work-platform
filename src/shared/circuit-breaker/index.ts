import CircuitBreaker from 'opossum';
import { Gauge } from 'prom-client';
import { logger } from '../observability/logger';

const circuitBreakerStateGauge = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state: 0=closed, 1=open, 2=half-open',
  labelNames: ['name'],
});

interface CircuitBreakerOptions {
  timeout?: number;       // ms before action is considered failed (default 10000)
  errorThresholdPercentage?: number; // % failures to trip (default 50)
  volumeThreshold?: number;          // min requests before tripping (default 3)
  resetTimeout?: number;  // ms before half-open probe (default 120000)
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 10_000,
  errorThresholdPercentage: 50,
  volumeThreshold: 3,
  resetTimeout: 120_000,
};

export function createCircuitBreaker<T extends unknown[], R>(
  name: string,
  fn: (...args: T) => Promise<R>,
  options: CircuitBreakerOptions = {},
): CircuitBreaker<T, R> {
  const breaker = new CircuitBreaker(fn, { ...DEFAULT_OPTIONS, ...options });

  breaker.on('open', () => {
    logger.info({ breaker: name }, 'Circuit breaker OPEN');
    circuitBreakerStateGauge.set({ name }, 1);
  });
  breaker.on('halfOpen', () => {
    logger.info({ breaker: name }, 'Circuit breaker HALF-OPEN');
    circuitBreakerStateGauge.set({ name }, 2);
  });
  breaker.on('close', () => {
    logger.info({ breaker: name }, 'Circuit breaker CLOSED');
    circuitBreakerStateGauge.set({ name }, 0);
  });

  // Initialise gauge to closed state
  circuitBreakerStateGauge.set({ name }, 0);

  return breaker;
}

// Named breakers — wrap the concrete action function at call site
export const emailBreaker = createCircuitBreaker(
  'email',
  async (fn: () => Promise<void>) => fn(),
);

export const samlBreaker = createCircuitBreaker(
  'saml',
  async (fn: () => Promise<unknown>) => fn(),
);

export const searchBreaker = createCircuitBreaker(
  'search',
  async (fn: () => Promise<unknown>) => fn(),
);

export const razorpayBreaker = createCircuitBreaker(
  'razorpay',
  async (fn: () => Promise<unknown>) => fn(),
);

export const storageBreaker = createCircuitBreaker(
  'storage',
  async (fn: () => Promise<unknown>) => fn(),
);
