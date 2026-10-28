/** Deliberately synthetic adapter: validates the port without claiming real Harness integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApplication } from './application.ts';
import { editableGraph } from '../../../packages/contracts/src/editing.ts';
import type { HarnessBehaviorAdapter, BehaviorAssignment } from '../../../packages/contracts/src/behavior.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = 'from typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    question: str\n    answer: str\ndef work(state):\n    return {"answer": "old"}\ng = StateGraph(State)\ng.add_node("work", work)\ng.add_edge(START, "work")\ng.add_edge("work", END)\napp = g.compile()\n';
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
async function fixture(adapter?: HarnessBehaviorAdapter, timeoutMs?: number) {
  const prefix = join(tmpdir(), 'langcontour-behavior-api-');
  const directory = await mkdtemp(prefix);
  await writeFile(join(directory, 'graph.py'), SOURCE);
  let app: ReturnType<typeof createApplication>, server: ReturnType<typeof createServer>, base: string;
  async function start() {
    app = createApplication({ repoRoot, behaviorTaskAdapter: adapter, behaviorRequestTimeoutMs: timeoutMs });
    server = createServer(async (req, res) => { await app.handler(req, res); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  }
  async function stop() { app.close(); await new Promise<void>(done => server.close(() => done())); }
  await start();
  async function call(path: string, body?: unknown) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const openedResponse = await call('/projects', { root: directory });
  assert.equal(openedResponse.status, 200, JSON.stringify(openedResponse.body));
  const opened = openedResponse.body;
  const graph = opened.analysis.graphs[0], target = editableGraph(graph);
  target.nodes.find(n => n.id === 'work')!.description = '将 question 转大写写入 answer。';
  const path = '/projects/' + opened.project.id;
  const preview = (await call(path + '/source-previews', { schemaVersion: 1, requestId: 'behavior-template-001', graphId: graph.id,
    baseRevision: graph.revision, target, confirmed: true })).body;
  const request = { schemaVersion: 1, requestId: 'behavior-request-001', transactionId: preview.transaction.id, reviewHash: preview.transaction.reviewHash, confirmed: true };
  const workspaces: string[] = [];
  return { directory, path, request, call, workspaces,
    async until(taskId: string, state: string) {
      for (let i = 0; i < 50; ++i) {
        const value = await call(path + '/behavior-tasks/' + taskId);
        if (value.body.status === state) return value.body;
        await wait(10);
      }
      throw new Error('task did not reach ' + state);
    },
    async restart() { await stop(); await start(); await call('/projects', { root: directory }); },
    async close() {
      await stop();
      for (const workspace of workspaces) {
        const target = resolve(workspace);
        assert.equal(resolve(tmpdir()), resolve(target, '..')); assert.ok(target.split(/[\\/]/).at(-1)!.startsWith('langcontour-behavior-'));
        await rm(target, { recursive: true, force: true });
      }
      assert.ok(resolve(directory).startsWith(resolve(prefix))); await rm(directory, { recursive: true, force: true });
    },
  };
}

test('default behavior adapter is honestly unavailable and explicit confirmation is mandatory', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('/behavior-support')).body.available, false);
    assert.equal((await f.call(f.path + '/behavior-tasks', { ...f.request, confirmed: false })).status, 400);
    assert.equal((await f.call(f.path + '/behavior-tasks', f.request)).body.error.code, 'HARNESS_NOT_CONNECTED');
    assert.deepEqual((await f.call(f.path + '/behavior-tasks')).body.tasks, []);
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), SOURCE);
  } finally { await f.close(); }
});

test('confirmed task runs only in a copy; durable dedup, restart, result review, explicit apply and undo', async () => {
  let submits = 0; let assignment: BehaviorAssignment | undefined;
  let state: 'running' | 'succeeded' = 'running';
  const adapter: HarnessBehaviorAdapter = {
    async submit(value) { ++submits; assignment = value; return { hostTaskId: 'synthetic-host-001' }; },
    async getStatus() { return { status: state, hostTaskId: 'synthetic-host-001' }; },
    async cancel() { return { acknowledged: true }; },
  };
  const f = await fixture(adapter);
  try {
    const [a, b] = await Promise.all([f.call(f.path + '/behavior-tasks', f.request), f.call(f.path + '/behavior-tasks', f.request)]);
    assert.equal(a.status, 202); assert.equal(a.body.id, b.body.id);
    await f.until(a.body.id, 'running'); assert.equal(submits, 1); assert.ok(assignment);
    f.workspaces.push(assignment.workingDirectory);
    assert.notEqual(resolve(assignment.workingDirectory), resolve(f.directory));
    assert.equal(assignment.originalProjectWriteAllowed, false); assert.equal(assignment.executeProjectAllowed, false);
    const file = join(assignment.workingDirectory, 'graph.py');
    await writeFile(file, (await readFile(file, 'utf8')).replace('return {"answer": "old"}', 'return {"answer": state["question"].upper()}'));
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), SOURCE);
    await f.restart(); state = 'succeeded';
    const result = await f.until(a.body.id, 'review_ready'); assert.equal(submits, 1);
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), SOURCE);
    const txPath = f.path + '/transactions/' + result.resultTransactionId;
    const review = (await f.call(txPath)).body;
    assert.equal(review.transaction.kind, 'behavior'); assert.match(review.files[0].diff, /upper/);
    const confirm = { schemaVersion: 1, reviewHash: review.transaction.reviewHash, confirmed: true, acknowledgedWarnings: true };
    assert.equal((await f.call(txPath + '/apply', { ...confirm, confirmed: false })).status, 400);
    assert.equal((await f.call(txPath + '/apply', confirm)).body.transaction.status, 'applied');
    assert.match(await readFile(join(f.directory, 'graph.py'), 'utf8'), /upper/);
    await f.call(txPath + '/undo', confirm); assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), SOURCE);
    await f.call(f.path + '/behavior-tasks', f.request); assert.equal(submits, 1);
  } finally { await f.close(); }
});

test('uncertain submit receipt never resubmits; read lookup recovers the host ID', async () => {
  let submits = 0; let assignment: BehaviorAssignment | undefined; let reported = false;
  const adapter: HarnessBehaviorAdapter = {
    async submit(value) { ++submits; assignment = value; throw new Error('synthetic lost response'); },
    async getStatus() { return reported ? { status: 'running', hostTaskId: 'recovered-host' } : { status: 'unknown' }; },
    async cancel() { return { acknowledged: true }; },
  };
  const f = await fixture(adapter);
  try {
    const task = (await f.call(f.path + '/behavior-tasks', f.request)).body;
    await f.until(task.id, 'needs_attention'); assert.ok(assignment); f.workspaces.push(assignment.workingDirectory);
    await f.call(f.path + '/behavior-tasks', f.request); assert.equal(submits, 1);
    reported = true; await f.restart(); await f.until(task.id, 'running'); assert.equal(submits, 1);
    const cancelled = await f.call(f.path + '/behavior-tasks/' + task.id + '/cancel', { schemaVersion: 1, confirmed: true });
    assert.equal(cancelled.body.status, 'cancelled');
  } finally { await f.close(); }
});

test('cancellation waits for acknowledgement and ignores a late successful result', async () => {
  let assignment: BehaviorAssignment | undefined; let state: 'running' | 'succeeded' = 'running'; let cancels = 0;
  const adapter: HarnessBehaviorAdapter = {
    async submit(value) { assignment = value; return { hostTaskId: 'cancel-host' }; },
    async getStatus() { return { status: state, hostTaskId: 'cancel-host' }; },
    async cancel() { ++cancels; return { acknowledged: false }; },
  };
  const f = await fixture(adapter);
  try {
    const task = (await f.call(f.path + '/behavior-tasks', f.request)).body;
    await f.until(task.id, 'running'); f.workspaces.push(assignment!.workingDirectory);
    const path = f.path + '/behavior-tasks/' + task.id;
    assert.equal((await f.call(path + '/cancel', { schemaVersion: 1, confirmed: false })).status, 400);
    assert.equal(cancels, 0);
    assert.equal((await f.call(path + '/cancel', { schemaVersion: 1, confirmed: true })).body.status, 'cancelling');
    state = 'succeeded'; const value = await f.until(task.id, 'cancelled'); assert.equal(value.resultTransactionId, undefined);
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), SOURCE);
  } finally { await f.close(); }
});

test('submit timeout retains uncertain state and does not retry execution', async () => {
  let submits = 0; let assignment: BehaviorAssignment | undefined;
  const adapter: HarnessBehaviorAdapter = {
    async submit(value, { signal }) { ++submits; assignment = value; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return { hostTaskId: 'never' }; },
    async getStatus() { return { status: 'unknown' }; },
    async cancel() { return { acknowledged: true }; },
  };
  const f = await fixture(adapter, 25);
  try {
    const task = (await f.call(f.path + '/behavior-tasks', f.request)).body;
    await f.until(task.id, 'needs_attention'); f.workspaces.push(assignment!.workingDirectory);
    await f.call(f.path + '/behavior-tasks', f.request); assert.equal(submits, 1);
    await f.call(f.path + '/behavior-tasks/' + task.id + '/cancel', { schemaVersion: 1, confirmed: true });
  } finally { await f.close(); }
});
