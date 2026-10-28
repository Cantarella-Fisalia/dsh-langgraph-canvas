import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probePython, resolvePythonCommand } from '../runtime/python.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nodeTests = [
  'apps/frontend/src/branding.test.ts',
  'apps/frontend/src/workspace-cache.test.ts',
  'apps/frontend/src/analysis-monitor.test.ts',
  'plugins/harness/tests/session-channel.test.mjs',
  'plugins/harness/tests/behavior-adapter.test.mjs',
  'plugins/harness/tests/analysis-adapter.test.mjs', 'apps/backend/src/deep-analysis.test.ts',
  'apps/backend/src/worker.test.ts', 'apps/backend/src/backend.test.ts',
  'apps/backend/src/edit-requests.test.ts', 'apps/backend/src/source-previews.test.ts',
  'apps/backend/src/transactions.test.ts', 'apps/backend/src/behavior-tasks.test.ts',
  'apps/frontend/src/host.test.ts', 'packages/contracts/src/editing.test.ts',
  'apps/frontend/src/analysis-view.test.ts', 'apps/frontend/src/flowchart.test.ts', 'apps/frontend/src/graph-navigation.test.ts',
];
try {
  const python = await probePython(resolvePythonCommand(), { cwd: root });
  console.log(`Python ${python.version}: ${python.executable}`);
  // Both Node-created workers and the unittest process receive exactly the validated executable.
  const env = { ...process.env, DSH_LANGGRAPH_CANVAS_PYTHON: python.executable, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  const run = (command, args) => new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', error => { console.error(error.message); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = await run(process.execPath, ['--test', ...nodeTests])
    || await run(python.executable, ['-m', 'unittest', 'discover', '-s', 'services/python-worker/tests', '-v']);
} catch (error) { console.error(`[${error.code || 'PYTHON_ERROR'}] ${error.message}`); process.exitCode = 1; }
