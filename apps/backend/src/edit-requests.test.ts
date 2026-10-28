import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createApplication } from './application.ts';
import { editableGraph } from '../../../packages/contracts/src/editing.ts';
import type { EditRequestAdapter, ConfirmedEditIntent } from '../../../packages/contracts/src/editing.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
async function fixture(adapter?: EditRequestAdapter) {
  const prefix = join(tmpdir(), 'vis4agent-edit-');
  const directory = await mkdtemp(prefix);
  const source = 'from typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    question: str\ndef work(state):\n    return {}\ng = StateGraph(State)\ng.add_node("work", work)\ng.add_edge(START, "work")\ng.add_edge("work", END)\n';
  await writeFile(join(directory, 'graph.py'), source, 'utf8');
  const app = createApplication({ repoRoot, editRequestAdapter: adapter });
  const server = createServer(async (req, res) => { await app.handler(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  async function call(path: string, body?: unknown) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const opened = await call('/projects', { root: directory });
  const graph = opened.body.analysis.graphs[0];
  const target = editableGraph(graph);
  target.state.fields.push({ name: 'answer', annotation: 'str' });
  return { directory, source, graph, target, route: '/projects/' + opened.body.project.id + '/edit-requests', call,
    async close() {
      app.close(); await new Promise<void>(done => server.close(() => done()));
      assert.ok(resolve(directory).startsWith(resolve(prefix)) && resolve(directory) !== resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    } };
}
test('only explicit confirmation reaches adapter; duplicate concurrent requests are idempotent and source remains untouched', async () => {
  const received: ConfirmedEditIntent[] = [];
  const f = await fixture({ async submit(intent) { received.push(intent); return { taskId: 'test-task-' + received.length }; } });
  const request = { schemaVersion: 1, requestId: 'confirmation-001', graphId: f.graph.id, baseRevision: f.graph.revision, target: f.target, confirmed: true };
  try {
    assert.equal((await f.call('/edit-support')).body.available, true);
    assert.equal(received.length, 0);
    const unconfirmed = await f.call(f.route, { ...request, confirmed: false });
    assert.equal(unconfirmed.status, 400); assert.equal(unconfirmed.body.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal((await f.call(f.route, { ...request, confirmed: undefined })).status, 400);
    assert.equal(received.length, 0);
    assert.equal((await f.call(f.route, { ...request, baseRevision: 'old-version' })).body.error.code, 'SOURCE_CHANGED');
    assert.equal((await f.call(f.route, { ...request, target: editableGraph(f.graph) })).body.error.code, 'NO_CHANGES');
    assert.equal(received.length, 0);
    const [a, b] = await Promise.all([f.call(f.route, request), f.call(f.route, request)]);
    assert.equal(a.status, 202); assert.deepEqual(a.body, b.body); assert.equal(received.length, 1);
    assert.equal(received[0].sourceWriteAllowed, false);
    assert.equal(received[0].project.root, f.directory);
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), f.source);
    assert.equal((await f.call(f.route, { ...request, target: editableGraph(f.graph) })).body.error.code, 'REQUEST_ID_REUSED');
    await writeFile(join(f.directory, 'graph.py'), f.source + '# external edit\n');
    assert.equal((await f.call(f.route, request)).body.taskId, a.body.taskId);
    assert.equal((await f.call(f.route, { ...request, requestId: 'confirmation-002' })).body.error.code, 'SOURCE_CHANGED');
    assert.equal(received.length, 1);
  } finally { await f.close(); }
});
test('missing channel returns honest unavailability and cannot mutate files', async () => {
  const f = await fixture();
  try {
    const support = await f.call('/edit-support');
    assert.equal(support.body.available, false);
    const result = await f.call(f.route, { schemaVersion: 1, requestId: 'no-channel-001', graphId: f.graph.id,
      baseRevision: f.graph.revision, target: f.target, confirmed: true });
    assert.equal(result.status, 503); assert.equal(result.body.error.code, 'HARNESS_NOT_CONNECTED');
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), f.source);
  } finally { await f.close(); }
});
test('invalid structure never dispatches; adapter failure preserves a retryable request ID', async () => {
  let count = 0;
  const f = await fixture({ async submit() { if (++count === 1) throw new Error('receiver unavailable'); return { taskId: 'retried-task' }; } });
  const request = { schemaVersion: 1, requestId: 'retry-draft-001', graphId: f.graph.id, baseRevision: f.graph.revision, target: f.target, confirmed: true };
  try {
    const broken = { ...f.target, edges: [...f.target.edges, { id: 'bad', from: '__end__', to: 'missing', kind: 'normal' }] };
    assert.equal((await f.call(f.route, { ...request, target: broken })).body.error.code, 'INVALID_GRAPH_DRAFT');
    assert.equal(count, 0);
    assert.equal((await f.call(f.route, request)).status, 500);
    assert.equal((await f.call(f.route, request)).body.taskId, 'retried-task');
    assert.equal(count, 2);
    assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), f.source);
  } finally { await f.close(); }
});
