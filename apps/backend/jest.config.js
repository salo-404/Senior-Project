/** Unit tests: *.spec.ts next to the code. */
module.exports = {
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/unit-env.ts'],
};
