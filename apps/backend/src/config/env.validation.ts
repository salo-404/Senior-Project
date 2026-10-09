/** Environment contract. The app refuses to start when a required value is missing or malformed. */
export interface EnvVars {
  NODE_ENV: string;
  API_PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  OLLAMA_URL: string;
  AI_ENABLED: boolean;
  STORAGE_ENDPOINT: string;
  STORAGE_ACCESS_KEY: string;
  STORAGE_SECRET_KEY: string;
  STORAGE_BUCKET: string;
  CORS_ORIGINS: string[];
  WEB_URL: string;
  LOGIN_RATE_LIMIT: number;
  GLOBAL_RATE_LIMIT: number;
}

const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'OLLAMA_URL',
  'AI_ENABLED',
  'STORAGE_ENDPOINT',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'CORS_ORIGINS',
  'WEB_URL',
] as const;

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const errors: string[] = [];
  const str = (key: string): string => {
    const value = raw[key];
    return typeof value === 'string' ? value.trim() : '';
  };

  for (const key of REQUIRED) {
    if (!str(key)) errors.push(`${key} is required`);
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (str(key) && str(key).length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  if (str('JWT_ACCESS_SECRET') && str('JWT_ACCESS_SECRET') === str('JWT_REFRESH_SECRET')) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  const aiEnabled = str('AI_ENABLED').toLowerCase();
  if (aiEnabled && !['true', 'false'].includes(aiEnabled)) errors.push('AI_ENABLED must be "true" or "false"');

  const int = (key: string, fallback: number): number => {
    const value = str(key);
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      errors.push(`${key} must be a positive integer`);
      return fallback;
    }
    return n;
  };
  const apiPort = int('API_PORT', 3000);
  const loginRateLimit = int('LOGIN_RATE_LIMIT', 5);
  const globalRateLimit = int('GLOBAL_RATE_LIMIT', 120);

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    NODE_ENV: str('NODE_ENV') || 'development',
    API_PORT: apiPort,
    DATABASE_URL: str('DATABASE_URL'),
    REDIS_URL: str('REDIS_URL'),
    JWT_ACCESS_SECRET: str('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: str('JWT_REFRESH_SECRET'),
    OLLAMA_URL: str('OLLAMA_URL').replace(/\/+$/, ''),
    AI_ENABLED: aiEnabled === 'true',
    STORAGE_ENDPOINT: str('STORAGE_ENDPOINT'),
    STORAGE_ACCESS_KEY: str('STORAGE_ACCESS_KEY'),
    STORAGE_SECRET_KEY: str('STORAGE_SECRET_KEY'),
    STORAGE_BUCKET: str('STORAGE_BUCKET') || 'maintain',
    CORS_ORIGINS: str('CORS_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),
    WEB_URL: str('WEB_URL').replace(/\/+$/, ''),
    LOGIN_RATE_LIMIT: loginRateLimit,
    GLOBAL_RATE_LIMIT: globalRateLimit,
  };
}
