#!/usr/bin/env node

const path = require('node:path');
const { spawn } = require('node:child_process');

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const target = process.argv[2] ?? 'api';
  const extraArguments = process.argv.slice(3);

  const entryByTarget = {
    api: path.join(repoRoot, 'apps', 'orchestrator-api', 'dist', 'src', 'main.js'),
    worker: path.join(repoRoot, 'apps', 'document-processing-worker', 'dist', 'src', 'main.js')
  };

  const command = entryByTarget[target] === undefined ? target : process.execPath;
  const args = entryByTarget[target] === undefined ? extraArguments : [entryByTarget[target], ...extraArguments];

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit'
  });

  process.once('SIGINT', () => {
    child.kill('SIGINT');
  });
  process.once('SIGTERM', () => {
    child.kill('SIGTERM');
  });

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

module.exports = {
  main
};

if (require.main === module) {
  main();
}
