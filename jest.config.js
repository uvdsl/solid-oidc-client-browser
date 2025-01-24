module.exports = {
    testEnvironment: 'jsdom',
    verbose: false,
    setupFilesAfterEnv: ['<rootDir>/../../jest-setup.ts'],
      
    transform: {
      '^.+\\.vue$': '@vue/vue3-jest',
      '^.+\\.jsx?$': 'babel-jest',
      '^.+\\.tsx?$': [
        'ts-jest',
        {},
      ],
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(js|ts)$',
    moduleFileExtensions: [
        'js',
        'ts',
        'vue',
      ],
      moduleNameMapper: {
        '^@shared/(.*)$': '<rootDir>/../$1',
      },
      coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/',
      ],
      coverageReporters: [
        'text',
        'json-summary',
      ],
      testEnvironmentOptions: {
        customExportConditions: [
          'node',
          'node-addons',
        ],
      },
    }