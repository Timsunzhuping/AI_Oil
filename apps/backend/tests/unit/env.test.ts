import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv, resetEnvCache, isLocal, isTest, isProduction } from '../../src/config/env.js';

describe('layered env loader', () => {
  const original = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...original };
    resetEnvCache();
  });

  it('parses defaults when only NODE_ENV is set', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;

    const env = loadEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBeTypeOf('number');
    expect(env.LOG_LEVEL).toBeTypeOf('string');
  });

  it('coerces PORT from string to number', () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4321';
    expect(loadEnv().PORT).toBe(4321);
  });

  it('parses ENABLE_SWAGGER as boolean', () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_SWAGGER = 'false';
    expect(loadEnv().ENABLE_SWAGGER).toBe(false);
  });

  it('isTest / isLocal / isProduction reflect NODE_ENV', () => {
    process.env.NODE_ENV = 'test';
    expect(isTest()).toBe(true);
    expect(isLocal()).toBe(false);
    expect(isProduction()).toBe(false);

    resetEnvCache();
    process.env.NODE_ENV = 'prod';
    expect(isProduction()).toBe(true);

    resetEnvCache();
    process.env.NODE_ENV = 'local';
    expect(isLocal()).toBe(true);
  });
});
