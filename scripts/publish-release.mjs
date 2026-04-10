import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const packageDirs = [
  path.join(rootDir, 'packages/client'),
  path.join(rootDir, 'packages/server'),
];

const cliArgs = new Set(process.argv.slice(2));
const dryRun = cliArgs.has('--dry-run');
const tagArg = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--tag='))
  ?.slice('--tag='.length);

async function readJson(filePath) {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function packageVersionExists(name, version) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['view', `${name}@${version}`, 'version'], {
      stdio: 'ignore',
      shell: false,
    });

    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function main() {
  const rootPackage = await readJson(path.join(rootDir, 'package.json'));
  const releaseTag = tagArg ?? process.env.GITHUB_REF_NAME ?? '';
  const expectedTag = `v${rootPackage.version}`;

  if (releaseTag && releaseTag !== expectedTag) {
    throw new Error(`Release tag mismatch: expected ${expectedTag} but received ${releaseTag}`);
  }

  for (const packageDir of packageDirs) {
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = await readJson(packageJsonPath);

    if (packageJson.version !== rootPackage.version) {
      throw new Error(
        `${packageJson.name} version ${packageJson.version} does not match workspace version ${rootPackage.version}`,
      );
    }

    const alreadyPublished = await packageVersionExists(packageJson.name, packageJson.version);
    if (alreadyPublished) {
      console.log(`Skipping ${packageJson.name}@${packageJson.version}; already published.`);
      continue;
    }

    if (dryRun) {
      console.log(`Would publish ${packageJson.name}@${packageJson.version}.`);
      continue;
    }

    console.log(`Publishing ${packageJson.name}@${packageJson.version}...`);
    await run('npm', ['publish', '--access', 'public'], { cwd: packageDir });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
