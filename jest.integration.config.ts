import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
  // --runInBand: integration tests run sequentially to avoid DB/Redis conflicts
  runInBand: true,
  globalSetup: '<rootDir>/tests/setup.ts',
};

export default config;
