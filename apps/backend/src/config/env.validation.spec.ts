import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  OLLAMA_URL: 'http://localhost:11434/',
  AI_ENABLED: 'false',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'k',
  STORAGE_SECRET_KEY: 's',
  CORS_ORIGINS: 'http://a.test, http://b.test',
  WEB_URL: 'http://localhost:3001/',
};

describe('validateEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.OLLAMA_URL).toBe('http://localhost:11434');
    expect(env.WEB_URL).toBe('http://localhost:3001');
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.LOGIN_RATE_LIMIT).toBe(5);
    expect(env.STORAGE_BUCKET).toBe('maintain');
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OLLAMA_URL', 'AI_ENABLED'])(
    'refuses to start without %s',
    (key) => {
      expect(() => validateEnv({ ...valid, [key]: undefined })).toThrow(key);
    },
  );

  it('rejects short or identical JWT secrets', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow('at least 32');
    expect(() => validateEnv({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET })).toThrow('must differ');
  });

  it('rejects a non-boolean AI_ENABLED', () => {
    expect(() => validateEnv({ ...valid, AI_ENABLED: 'maybe' })).toThrow('AI_ENABLED');
  });
});
