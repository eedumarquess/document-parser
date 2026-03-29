#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

async function main() {
  console.log('[docker-dev-bootstrap] Installing workspace dependencies...');
  await runPnpm(['install', '--frozen-lockfile'], repoRoot);

  const linkMap = parseLinkMap(process.env.PNPM_LINK_MAP);
  const consumers = loadWorkspaceConsumers(repoRoot);
  const installedExternalLibraries = new Set();
  const linkedTargets = new Set();

  for (const [consumerName, requestedPaths] of Object.entries(linkMap)) {
    if (!consumers.has(consumerName)) {
      throw new Error(
        `PNPM_LINK_MAP references unknown workspace consumer "${consumerName}". ` +
          `Expected one of: ${Array.from(consumers.keys()).sort().join(', ')}`
      );
    }

    for (const requestedPath of requestedPaths) {
      const externalLibrary = validateExternalLibrary(requestedPath);
      if (!installedExternalLibraries.has(externalLibrary.absolutePath)) {
        console.log(
          `[docker-dev-bootstrap] Installing external library ${externalLibrary.packageName} from ${externalLibrary.absolutePath}...`
        );
        await runPnpm(['install'], externalLibrary.absolutePath);
        installedExternalLibraries.add(externalLibrary.absolutePath);
      }

      const targetKey = `${consumerName}::${externalLibrary.absolutePath}`;
      if (linkedTargets.has(targetKey)) {
        continue;
      }

      console.log(
        `[docker-dev-bootstrap] Linking ${externalLibrary.packageName} into ${consumerName} from ${externalLibrary.absolutePath}...`
      );
      await runPnpm(['--filter', consumerName, 'link', externalLibrary.absolutePath], repoRoot);
      linkedTargets.add(targetKey);
    }
  }

  console.log('[docker-dev-bootstrap] Workspace bootstrap complete.');
}

function parseLinkMap(rawValue) {
  if (rawValue === undefined || rawValue.trim() === '') {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      `PNPM_LINK_MAP must be valid JSON. Received: ${rawValue}. ` +
        `Parser error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('PNPM_LINK_MAP must be a JSON object that maps consumer package names to arrays of absolute paths.');
  }

  const result = {};
  for (const [consumerName, requestedPaths] of Object.entries(parsed)) {
    if (!Array.isArray(requestedPaths)) {
      throw new Error(`PNPM_LINK_MAP entry for "${consumerName}" must be an array of absolute paths.`);
    }

    result[consumerName] = requestedPaths.map((value, index) => {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`PNPM_LINK_MAP entry ${consumerName}[${index}] must be a non-empty absolute path string.`);
      }

      return value.trim();
    });
  }

  return result;
}

function loadWorkspaceConsumers(rootDirectory) {
  const consumers = new Map();
  const manifests = [
    path.join(rootDirectory, 'package.json'),
    ...findPackageManifests(path.join(rootDirectory, 'apps')),
    ...findPackageManifests(path.join(rootDirectory, 'packages'))
  ];

  for (const manifestPath of manifests) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name === 'string' && manifest.name.trim() !== '') {
      consumers.set(manifest.name, path.dirname(manifestPath));
    }
  }

  return consumers;
}

function findPackageManifests(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, 'package.json'))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function validateExternalLibrary(requestedPath) {
  if (!path.isAbsolute(requestedPath)) {
    throw new Error(
      `External library path "${requestedPath}" is not absolute. ` +
        'Use absolute paths inside the container, such as /workspace/my-lib.'
    );
  }

  const absolutePath = path.normalize(requestedPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`External library path "${absolutePath}" does not exist.`);
  }

  const manifestPath = path.join(absolutePath, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`External library path "${absolutePath}" does not contain a package.json file.`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error(`External library manifest "${manifestPath}" must declare a non-empty package name.`);
  }

  return {
    absolutePath,
    manifestPath,
    packageName: manifest.name
  };
}

function runPnpm(args, cwd) {
  return runCommand(getCorepackCommand(), ['pnpm', ...args], cwd);
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Command "${command} ${args.join(' ')}" terminated with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

function getCorepackCommand() {
  return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

module.exports = {
  main,
  repoRoot,
  runPnpm
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[docker-dev-bootstrap] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
