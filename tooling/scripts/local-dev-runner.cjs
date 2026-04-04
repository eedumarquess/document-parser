#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { repoRoot, runPnpm, spawnPnpm } = require('./docker-dev-bootstrap.cjs');

const SERVICE_CONFIG = {
  api: {
    entryPath: 'apps/orchestrator-api/dist/src/main.js',
    runtimeVariable: 'ORCHESTRATOR_RUNTIME_MODE',
    tsconfigPaths: [
      'packages/shared-kernel/tsconfig.json',
      'packages/document-processing-domain/tsconfig.json',
      'packages/testkit/tsconfig.json',
      'apps/orchestrator-api/tsconfig.json'
    ]
  },
  worker: {
    entryPath: 'apps/document-processing-worker/dist/src/main.js',
    runtimeVariable: 'WORKER_RUNTIME_MODE',
    tsconfigPaths: [
      'packages/shared-kernel/tsconfig.json',
      'packages/document-processing-domain/tsconfig.json',
      'packages/testkit/tsconfig.json',
      'apps/document-processing-worker/tsconfig.json'
    ]
  }
};

async function main() {
  const serviceName = process.argv[2];
  if (serviceName !== 'api' && serviceName !== 'worker') {
    throw new Error('Usage: node tooling/scripts/local-dev-runner.cjs <api|worker>');
  }

  const config = SERVICE_CONFIG[serviceName];
  process.env[config.runtimeVariable] = process.env[config.runtimeVariable] ?? 'real';

  console.log(`[local-dev-runner] Building ${serviceName} for the first time...`);
  await runPnpm(['exec', 'tsc', '-b', ...config.tsconfigPaths, '--pretty', 'false'], repoRoot);

  const entryAbsolutePath = path.join(repoRoot, config.entryPath);
  if (!fs.existsSync(entryAbsolutePath)) {
    throw new Error(`Expected entry file "${config.entryPath}" to exist after the initial build.`);
  }

  console.log(`[local-dev-runner] Starting TypeScript watch for ${serviceName}...`);
  const typeScriptWatch = spawnPnpm(
    ['exec', 'tsc', '-b', ...config.tsconfigPaths, '--watch', '--preserveWatchOutput', '--pretty', 'false'],
    repoRoot
  );

  console.log(`[local-dev-runner] Starting Node watch for ${serviceName}...`);
  const applicationProcess = spawn(process.execPath, ['--watch', entryAbsolutePath], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit'
  });

  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopChild(typeScriptWatch);
    stopChild(applicationProcess);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  typeScriptWatch.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopChild(applicationProcess);
    exitWithChildStatus(code, signal);
  });

  applicationProcess.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopChild(typeScriptWatch);
    exitWithChildStatus(code, signal);
  });
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
}

function exitWithChildStatus(code, signal) {
  if (signal !== null) {
    console.error(`[local-dev-runner] Child process terminated with signal ${signal}.`);
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[local-dev-runner] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
