const commonProjectConfig = {
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json'
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts'],
  moduleNameMapper: {
    '^@document-parser/document-processing-domain$':
      '<rootDir>/../../packages/document-processing-domain/src',
    '^@document-parser/shared-infrastructure$':
      '<rootDir>/../../packages/shared-infrastructure/src',
    '^@document-parser/shared-kernel$': '<rootDir>/../../packages/shared-kernel/src',
    '^@document-parser/testkit$': '<rootDir>/../../packages/testkit/src'
  }
};

module.exports = {
  projects: [
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-domain',
      rootDir: '<rootDir>/apps/orchestrator-api',
      testMatch: ['<rootDir>/tests/domain/**/*.spec.ts']
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-application',
      rootDir: '<rootDir>/apps/orchestrator-api',
      testMatch: ['<rootDir>/tests/application/**/*.spec.ts']
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-contracts',
      rootDir: '<rootDir>/apps/orchestrator-api',
      testMatch: ['<rootDir>/tests/contracts/**/*.spec.ts'],
      slowTestThreshold: 60
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-e2e',
      rootDir: '<rootDir>/apps/orchestrator-api',
      testMatch: ['<rootDir>/tests/e2e/**/*.spec.ts']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-domain',
      rootDir: '<rootDir>/apps/document-processing-worker',
      testMatch: ['<rootDir>/tests/domain/**/*.spec.ts']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-application',
      rootDir: '<rootDir>/apps/document-processing-worker',
      testMatch: ['<rootDir>/tests/application/**/*.spec.ts']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-contracts',
      rootDir: '<rootDir>/apps/document-processing-worker',
      testMatch: ['<rootDir>/tests/contracts/**/*.spec.ts'],
      slowTestThreshold: 60
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-e2e',
      rootDir: '<rootDir>/apps/document-processing-worker',
      testMatch: ['<rootDir>/tests/e2e/**/*.spec.ts']
    }
  ]
};
