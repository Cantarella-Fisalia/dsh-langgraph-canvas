import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApplication } from './application.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
test('project read, source confinement, layout isolation and optimistic conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-langgraph-canvas-api-'));
  const source = 'from langgraph.graph import StateGraph, START, END\ng = StateGraph(dict)\ng.add_node("节点", worker)\ng.add_edge(START, "节点")\ng.add_edge("节点", END)\n';
  await writeFile(join(directory, 'graph.py'), source, 'utf8');
  const app = createApplication({ repoRoot });
  const server = createServer(async (req, res) => { if (!(await app.handler(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const opened = await call('/projects', 'POST', { root: directory });
    assert.equal(opened.status, 200);
    const id = opened.body.project.id;
    const warm = await call('/projects', 'POST', { root: directory, preferCached: true });
    assert.equal(warm.body.reused, true);
    assert.equal(warm.body.analysis.revision, opened.body.analysis.revision);
    const analysis = opened.body.analysis;
    assert.equal(analysis.graphs.length, 1);
    assert.equal(analysis.graphs[0].nodes[0].id, '节点');
    const graph = analysis.graphs[0];
    const layoutRoute = '/projects/' + id + '/layout';
    const layout = await call(layoutRoute + '?graphId=' + encodeURIComponent(graph.id));
    assert.equal(layout.body.revision, 'empty');
    const payload = { graphId: graph.id, graphRevision: analysis.revision,
      baseRevision: layout.body.revision, positions: { '节点': { x: 80, y: 100 } } };
    assert.equal((await call(layoutRoute, 'PUT', payload)).status, 200);
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), source);
    assert.equal((await call(layoutRoute, 'PUT', payload)).status, 409);
    assert.equal((await call('/projects/' + id + '/source?file=../outside.py')).status, 400);
    const sourceResult = await call('/projects/' + id + '/source?file=graph.py');
    assert.equal(sourceResult.body.content, source);
    await writeFile(join(directory, 'graph.py'), source + '# external edit\n', 'utf8');
    await new Promise(resolve => setTimeout(resolve, 30));
    const changed = await call('/projects', 'POST', { root: directory, preferCached: true });
    assert.notEqual(changed.body.analysis.revision, analysis.revision); assert.notEqual(changed.body.reused, true);
    const latestLayout = await call(layoutRoute + '?graphId=' + encodeURIComponent(graph.id));
    assert.equal((await call(layoutRoute, 'PUT', { ...payload, baseRevision: latestLayout.body.revision })).body.error.code, 'SOURCE_CHANGED');
    const caps = await call('/capabilities');
    assert.equal(caps.body.capabilities.length, 4);
    assert.ok(caps.body.capabilities.every((c: any) => c.status === 'not_configured'));
    const hostile = await fetch(base + '/projects', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: JSON.stringify({ root: directory }) });
    assert.equal(hostile.status, 403);
  } finally { app.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('invalid existing layout is not overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-langgraph-canvas-layout-'));
  await mkdir(join(directory, '.vislang'));
  await writeFile(join(directory, '.vislang/layout.json'), 'broken-layout');
  await writeFile(join(directory, 'graph.py'), 'from langgraph.graph import StateGraph\ng=StateGraph(dict)');
  const app = createApplication({ repoRoot });
  const server = createServer(async (req, res) => { await app.handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  try {
    const opened = await (await fetch(base + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: directory }) })).json();
    const response = await fetch(base + '/projects/' + opened.project.id + '/layout?graphId=g');
    assert.equal(response.status, 409);
    assert.equal(await readFile(join(directory, '.vislang/layout.json'), 'utf8'), 'broken-layout');
  } finally { app.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
