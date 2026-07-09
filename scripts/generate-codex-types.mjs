import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const generatedParentDir = path.join(rootDir, 'packages/client/shared/generated');
const targetDir = path.join(generatedParentDir, 'codex-app-server');
const backupDir = `${targetDir}.backup`;

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function restoreInterruptedSwap() {
  if (!existsSync(targetDir) && existsSync(backupDir)) {
    await rename(backupDir, targetDir);
  }

  if (existsSync(targetDir) && existsSync(backupDir)) {
    await rm(backupDir, { recursive: true, force: true });
  }
}

async function main() {
  await restoreInterruptedSwap();

  const temporaryDir = await mkdtemp(path.join(generatedParentDir, '.codex-app-server-'));
  const pnpmArgs = [
    '--filter',
    '@codori/server',
    'exec',
    'codex',
    'app-server',
    'generate-ts',
    '--experimental',
    '--out',
    temporaryDir,
  ];
  const packageManagerPath = process.env.npm_execpath;
  const command = packageManagerPath
    ? process.execPath
    : process.platform === 'win32'
      ? 'pnpm.cmd'
      : 'pnpm';
  const args = packageManagerPath ? [packageManagerPath, ...pnpmArgs] : pnpmArgs;

  try {
    await run(command, args);

    if (existsSync(targetDir)) {
      await rename(targetDir, backupDir);
    }

    try {
      await rename(temporaryDir, targetDir);
    } catch (error) {
      if (!existsSync(targetDir) && existsSync(backupDir)) {
        await rename(backupDir, targetDir);
      }
      throw error;
    }

    await rm(backupDir, { recursive: true, force: true });
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
