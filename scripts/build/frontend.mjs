import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tempRoot = join(root, '.tmp', 'build');
await mkdir(tempRoot, { recursive: true });
const temporary = await mkdtemp(join(tempRoot, 'frontend-'));
async function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
}
try {
  const checked = await run(['node_modules/typescript/bin/tsc', '--noEmit']);
  process.exitCode = checked || await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/frontend/vite.config.ts']);
} finally {
  // Only remove the directory this invocation created inside the build temp root.
  const path = resolve(temporary);
  if (path.startsWith(resolve(tempRoot) + sep)) {
    await rm(path, { recursive: true, force: true }).catch(error => console.warn('Build temp cleanup: ' + error.message));
  }
}
