import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { PythonWorker } from './worker.ts';
import { createApplication } from './application.ts';
import { resolvePythonCommand, checkPythonVersion, probePython } from '../../../scripts/runtime/python.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const legacyPython = 'C:/Users/31675/AppData/Local/Programs/Python/Python37-32/python.exe';
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'vis4agent-python-runtime-'));
  try {
    await writeFile(join(directory, 'graph.py'), 'from langgraph.graph import StateGraph\ng = StateGraph(dict)\n');
    await run(directory);
  } finally {
    assert.equal(resolve(dirname(directory)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(directory).startsWith('vis4agent-python-runtime-'));
    await rm(directory, { recursive: true, force: true });
  }
}
test('interpreter priority is explicit command, environment, installed fallback, then PATH', () => {
  assert.equal(resolvePythonCommand('explicit', { env: { VIS4AGENT_PYTHON: 'configured' }, exists: () => true }), 'explicit');
  assert.equal(resolvePythonCommand(undefined, { env: { VIS4AGENT_PYTHON: ' python3.12 ' }, exists: () => true }), 'python3.12');
  assert.equal(resolvePythonCommand(undefined, { env: {}, exists: () => true }), 'D:/Anaconda/python.exe');
  assert.equal(resolvePythonCommand(undefined, { env: {}, exists: () => false }), 'python');
});
test('unsupported Python versions produce a specific 503 with selected interpreter and repair instructions', () => {
  for (const version of [[3, 7, 9], [3, 10, 15]]) {
    assert.throws(() => checkPythonVersion({ version, executable: 'old-python' }, 'python'), (error: any) =>
      error.code === 'PYTHON_VERSION_UNSUPPORTED' && error.status === 503 && error.message.includes(version.join('.'))
      && error.message.includes('old-python') && error.message.includes('3.11+') && error.message.includes('VIS4AGENT_PYTHON'));
  }
  assert.equal(checkPythonVersion({ version: [3, 11, 0], executable: 'supported' }, 'python').version, '3.11.0');
  assert.throws(() => checkPythonVersion({}, 'python'), (error: any) => error.code === 'PYTHON_INVALID_RESPONSE');
});
test('selected interpreter passes isolated version inspection and concurrent default worker requests', async () => {
  const python = await probePython(); assert.match(python.version, /^3\.(?:1[1-9]|[2-9]\d)\./);
  await fixture(async directory => {
    const worker = new PythonWorker(repoRoot);
    try {
      const results = await Promise.all([worker.request<any>('analyze', { root: directory }), worker.request<any>('source', { root: directory, file: 'graph.py' })]);
      assert.equal(results[0].graphs.length, 1); assert.match(results[1].content, /StateGraph/);
    } finally { worker.close(); }
    await assert.rejects(worker.request('analyze', { root: directory }), (error: any) => error.code === 'CLOSED');
  });
});
test('closing during Python version inspection prevents a late worker start', async () => {
  const worker = new PythonWorker(repoRoot);
  const pending = worker.request('analyze', { root: repoRoot });
  worker.close();
  await assert.rejects(pending, (error: any) => ['PYTHON_START_ABORTED', 'CLOSED'].includes(error.code));
});
async function projectsError(pythonCommand: string, expectedCode: string) {
  await fixture(async directory => {
    const app = createApplication({ repoRoot, pythonCommand });
    const server = createServer((req, res) => { void app.handler(req, res); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/projects`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: directory }),
      });
      const body = await response.json();
      assert.equal(response.status, 503, JSON.stringify(body)); assert.equal(body.error.code, expectedCode);
      assert.match(body.error.message, /VIS4AGENT_PYTHON/);
    } finally { app.close(); await new Promise<void>(done => server.close(() => done())); }
  });
}
test('missing Python is an actionable API error instead of a worker traceback', async () => {
  await projectsError(join(repoRoot, '.tmp', 'no-such-python-runtime.exe'), 'PYTHON_START_FAILED');
});
test('installed legacy Python 3.7 is rejected before importing the worker', { skip: !existsSync(legacyPython) }, async () => {
  await projectsError(legacyPython, 'PYTHON_VERSION_UNSUPPORTED');
});
