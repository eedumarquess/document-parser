const path = require('node:path');

const repoRoot = __dirname;

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
      path.join(repoRoot, 'packages', 'document-processing-domain', 'src'),
    '^@document-parser/shared-infrastructure$':
      path.join(repoRoot, 'packages', 'shared-infrastructure', 'src'),
    '^@document-parser/shared-kernel$': path.join(repoRoot, 'packages', 'shared-kernel', 'src'),
    '^@document-parser/testkit$': path.join(repoRoot, 'packages', 'testkit', 'src')
  }
};

module.exports = {
  projects: [
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-domain',
      rootDir: path.join(repoRoot, 'apps', 'orchestrator-api'),
      testRegex: ['tests/domain/.+\\.spec\\.ts$']
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-application',
      rootDir: path.join(repoRoot, 'apps', 'orchestrator-api'),
      testRegex: ['tests/application/.+\\.spec\\.ts$']
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-contracts',
      rootDir: path.join(repoRoot, 'apps', 'orchestrator-api'),
      testRegex: ['tests/contracts/.+\\.spec\\.ts$'],
      slowTestThreshold: 60
    },
    {
      ...commonProjectConfig,
      displayName: 'orchestrator-e2e',
      rootDir: path.join(repoRoot, 'apps', 'orchestrator-api'),
      testRegex: ['tests/e2e/.+\\.spec\\.ts$']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-domain',
      rootDir: path.join(repoRoot, 'apps', 'document-processing-worker'),
      testRegex: ['tests/domain/.+\\.spec\\.ts$']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-application',
      rootDir: path.join(repoRoot, 'apps', 'document-processing-worker'),
      testRegex: ['tests/application/.+\\.spec\\.ts$']
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-contracts',
      rootDir: path.join(repoRoot, 'apps', 'document-processing-worker'),
      testRegex: ['tests/contracts/.+\\.spec\\.ts$'],
      slowTestThreshold: 60
    },
    {
      ...commonProjectConfig,
      displayName: 'worker-e2e',
      rootDir: path.join(repoRoot, 'apps', 'document-processing-worker'),
      testRegex: ['tests/e2e/.+\\.spec\\.ts$']
    }
  ]
};
