// Environment for the e2e app. AI is off, Ollama points at a closed port, Redis and storage are not required.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? '';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-0123456789abcdef012';
process.env.OLLAMA_URL = 'http://127.0.0.1:1';
process.env.AI_ENABLED = 'false';
process.env.STORAGE_ENDPOINT = 'http://127.0.0.1:1';
process.env.STORAGE_ACCESS_KEY = 'e2e-access';
process.env.STORAGE_SECRET_KEY = 'e2e-secret';
process.env.STORAGE_BUCKET = 'maintain-e2e';
process.env.CORS_ORIGINS = 'http://localhost:3001';
process.env.WEB_URL = 'http://localhost:3001';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.GLOBAL_RATE_LIMIT = '10000';
