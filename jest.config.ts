module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts'],
  verbose: false,
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  testMatch: ['<rootDir>/spec/**/?(*.)+(spec|test).ts'],
  collectCoverage: true,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'json'],
};