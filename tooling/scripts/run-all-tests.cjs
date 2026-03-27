const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const jestBin = require.resolve('jest/bin/jest');

const groups = [
  {
    name: 'domain',
    projects: ['orchestrator-domain', 'worker-domain']
  },
  {
    name: 'application',
    projects: ['orchestrator-application', 'worker-application']
  },
  {
    name: 'contracts',
    projects: ['orchestrator-contracts', 'worker-contracts']
  },
  {
    name: 'e2e',
    projects: ['orchestrator-e2e', 'worker-e2e']
  }
];

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-parser-tests-'));
const summaries = [];
const totals = createEmptySummary();

try {
  groups.forEach((group, index) => {
    console.log(`[${index + 1}/${groups.length}] Running ${group.name} tests`);
    const summary = runGroup(group);
    summaries.push({ name: group.name, summary });
    mergeSummary(totals, summary);
  });

  printFinalSummary(summaries, totals);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function runGroup(group) {
  const outputFile = path.join(tempDir, `${group.name}.json`);
  const result = spawnSync(
    process.execPath,
    [
      jestBin,
      '--config',
      'jest.workspace.config.cjs',
      '--selectProjects',
      ...group.projects,
      '--silent',
      '--json',
      '--outputFile',
      outputFile
    ],
    {
      cwd: rootDir,
      encoding: 'utf8'
    }
  );

  if (result.error) {
    throw result.error;
  }

  const summary = readSummary(outputFile, group.name);

  if (result.status !== 0) {
    process.stderr.write(`\n${group.name} tests failed.\n`);

    if (result.stderr && result.stderr.trim()) {
      process.stderr.write(`${result.stderr.trim()}\n`);
    }

    if (result.stdout && result.stdout.trim()) {
      process.stderr.write(`${result.stdout.trim()}\n`);
    }

    process.exit(result.status || 1);
  }

  return summary;
}

function readSummary(outputFile, groupName) {
  if (!fs.existsSync(outputFile)) {
    throw new Error(`Jest did not produce a JSON summary for the ${groupName} group.`);
  }

  return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
}

function createEmptySummary() {
  return {
    numFailedTestSuites: 0,
    numPassedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTestSuites: 0,
    numFailedTests: 0,
    numPassedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTests: 0
  };
}

function mergeSummary(target, source) {
  target.numFailedTestSuites += source.numFailedTestSuites;
  target.numPassedTestSuites += source.numPassedTestSuites;
  target.numPendingTestSuites += source.numPendingTestSuites;
  target.numTotalTestSuites += source.numTotalTestSuites;
  target.numFailedTests += source.numFailedTests;
  target.numPassedTests += source.numPassedTests;
  target.numPendingTests += source.numPendingTests;
  target.numTodoTests += source.numTodoTests;
  target.numTotalTests += source.numTotalTests;
}

function printFinalSummary(groupSummaries, overall) {
  console.log('\nTest summary');

  groupSummaries.forEach(({ name, summary }) => {
    console.log(
      `- ${name}: suites ${formatSuites(summary)} | tests ${formatTests(summary)}`
    );
  });

  console.log(
    `- overall: suites ${formatSuites(overall)} | tests ${formatTests(overall)}`
  );
}

function formatSuites(summary) {
  return formatCounters({
    failed: summary.numFailedTestSuites,
    passed: summary.numPassedTestSuites,
    skipped: summary.numPendingTestSuites,
    total: summary.numTotalTestSuites
  });
}

function formatTests(summary) {
  return formatCounters({
    failed: summary.numFailedTests,
    passed: summary.numPassedTests,
    skipped: summary.numPendingTests,
    todo: summary.numTodoTests,
    total: summary.numTotalTests
  });
}

function formatCounters(input) {
  const parts = [];

  if (input.failed > 0) {
    parts.push(`${input.failed} failed`);
  }

  if (input.passed > 0) {
    parts.push(`${input.passed} passed`);
  }

  if (input.skipped > 0) {
    parts.push(`${input.skipped} skipped`);
  }

  if (input.todo > 0) {
    parts.push(`${input.todo} todo`);
  }

  parts.push(`${input.total} total`);

  return parts.join(', ');
}
