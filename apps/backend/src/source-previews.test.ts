import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createApplication } from './application.ts';
import { editableGraph } from '../../../packages/contracts/src/editing.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = 'from typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    question: str\ndef work(state):\n    return {}\ng = StateGraph(State)\ng.add_node("work", work)\ng.add_edge(START, "work")\ng.add_edge("work", END)\napp = g.compile()\n';

test('confirmed source preview works without Harness; deduplicates, preserves source and rejects stale or invalid drafts', async () => {
  const prefix = join(tmpdir(), 'dsh-langgraph-canvas-preview-api-');
  const directory = await mkdtemp(prefix);
  await writeFile(join(directory, 'graph.py'), SOURCE);
  let harnessCalls = 0;
  const app = createApplication({ repoRoot, editRequestAdapter: { async submit() { ++harnessCalls; return { taskId: 'not-used' }; } } });
  const server = createServer(async (req, res) => { await app.handler(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const opened = (await post('/projects', { root: directory })).body;
    const graph = opened.analysis.graphs[0];
    const target = editableGraph(graph);
    target.state.fields.push({ name: 'answer', annotation: 'str' });
    const route = '/projects/' + opened.project.id + '/source-previews';
    const request = { schemaVersion: 1, requestId: 'source-preview-001', graphId: graph.id, baseRevision: graph.revision, target, confirmed: true };
    assert.equal((await post(route, { ...request, confirmed: undefined })).body.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal((await post(route, { ...request, confirmed: false })).status, 400);
    const [a, b] = await Promise.all([post(route, request), post(route, request)]);
    assert.equal(a.status, 200); assert.deepEqual(a.body, b.body);
    assert.equal(a.body.verified, true); assert.equal(a.body.originalModified, false);
    assert.match(a.body.files[0].after, /answer: str/);
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), SOURCE);
    assert.equal(harnessCalls, 0);
    assert.equal((await post(route, { ...request, target: editableGraph(graph) })).body.error.code, 'REQUEST_ID_REUSED');
    assert.equal((await post(route, { ...request, requestId: 'no-changes-001', target: editableGraph(graph) })).body.error.code, 'NO_CHANGES');
    const unsafe = structuredClone(target);
    unsafe.state.fields[1].annotation = '__import__("os").system("never run")';
    assert.equal((await post(route, { ...request, requestId: 'unsafe-type-001', target: unsafe })).status, 422);
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), SOURCE);
    await writeFile(join(directory, 'graph.py'), SOURCE + '# external change\n');
    assert.equal((await post(route, request)).body.error.code, 'SOURCE_CHANGED');
    assert.equal((await post(route, { ...request, requestId: 'new-stale-001' })).status, 409);
    assert.equal(harnessCalls, 0);
  } finally {
    app.close(); await new Promise<void>(done => server.close(() => done()));
    assert.ok(resolve(directory).startsWith(resolve(prefix)) && resolve(directory) !== resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
