/** End-to-end tests: run against a throwaway database created by global-setup. */
module.exports = {
  rootDir: '..',
  testRegex: 'test/.*\.e2e-spec\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFiles: ['<rootDir>/test/e2e-env.ts'],
  // Empties every table before each test file so files that reuse the same test emails cannot collide.
  setupFilesAfterEnv: ['<rootDir>/test/e2e-clean-db.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
};
