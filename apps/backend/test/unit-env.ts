// Minimal environment so unit tests never depend on a developer's .env file.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'unit-test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'unit-test-refresh-secret-0123456789abcdef';
