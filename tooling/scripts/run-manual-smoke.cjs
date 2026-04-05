const { spawnSync } = require('node:child_process');
const path = require('node:path');

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const scriptPath = path.join(__dirname, 'manual-smoke.ps1');

const result = spawnSync(
  'powershell',
  ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...forwardedArgs],
  {
    stdio: 'inherit'
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
