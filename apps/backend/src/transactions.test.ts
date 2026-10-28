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
const source = 'from typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    question: str\ndef work(state):\n    return {}\ng = StateGraph(State)\ng.add_node("work", work)\ng.add_edge(START, "work")\ng.add_edge("work", END)\napp = g.compile()\n';

async function serve() {
  const app = createApplication({ repoRoot });
  const server = createServer(async (req, res) => { await app.handler(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  return {
    async call(path: string, body?: unknown) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    async close() { app.close(); await new Promise<void>(done => server.close(() => done())); },
  };
}

test('durable source review survives restart; only reviewed confirmation applies, stale undo is blocked and confirmed undo restores bytes', async () => {
  const prefix = join(tmpdir(), 'vis4agent-tx-api-');
  const directory = await mkdtemp(prefix);
  await writeFile(join(directory, 'graph.py'), source);
  let runtime = await serve();
  try {
    const opened = (await runtime.call('/projects', { root: directory })).body;
    const graph = opened.analysis.graphs[0];
    const target = editableGraph(graph); target.state.fields.push({ name: 'answer', annotation: 'str' });
    const projectPath = '/projects/' + opened.project.id;
    const request = { schemaVersion: 1, requestId: 'persistent-review-001', graphId: graph.id, baseRevision: graph.revision, target, confirmed: true };
    const prepared = await runtime.call(projectPath + '/source-previews', request);
    assert.equal(prepared.status, 200);
    assert.match(prepared.body.files[0].diff, /\+    answer: str/);
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), source);
    const tx = prepared.body.transaction;
    assert.equal(tx.status, 'prepared');
    await runtime.close(); runtime = await serve();
    await runtime.call('/projects', { root: directory });
    const txPath = projectPath + '/transactions/' + tx.id;
    assert.equal((await runtime.call(projectPath + '/transactions')).body.transactions[0].status, 'prepared');
    assert.equal((await runtime.call(txPath)).body.transaction.reviewHash, tx.reviewHash);
    const confirm = { schemaVersion: 1, confirmed: true, reviewHash: tx.reviewHash, acknowledgedWarnings: true };
    assert.equal((await runtime.call(txPath + '/apply', { ...confirm, confirmed: false })).status, 400);
    assert.equal((await runtime.call(txPath + '/apply', { ...confirm, reviewHash: '0'.repeat(64) })).body.error.code, 'REVIEW_CHANGED');
    assert.equal((await runtime.call(txPath + '/apply', { ...confirm, acknowledgedWarnings: false })).status, 400);
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), source);
    assert.equal((await runtime.call(txPath + '/apply', confirm)).body.transaction.status, 'applied');
    const generated = await readFile(join(directory, 'graph.py'), 'utf8');
    assert.match(generated, /answer: str/);
    assert.equal((await runtime.call(projectPath + '/graphs')).body.revision, tx.generatedRevision);
    assert.equal((await runtime.call(txPath + '/apply', confirm)).body.transaction.status, 'applied');
    await writeFile(join(directory, 'graph.py'), generated + '# external edit\n');
    assert.equal((await runtime.call(txPath + '/undo', confirm)).body.error.code, 'SOURCE_CHANGED');
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), generated + '# external edit\n');
    await writeFile(join(directory, 'graph.py'), generated);
    assert.equal((await runtime.call(txPath + '/undo', confirm)).body.transaction.status, 'undone');
    assert.equal(await readFile(join(directory, 'graph.py'), 'utf8'), source);
    assert.equal((await runtime.call(txPath + '/undo', confirm)).body.transaction.status, 'undone');
    assert.equal((await runtime.call(txPath + '/apply', confirm)).body.error.code, 'INVALID_STATE');
    const conflict = structuredClone(request); conflict.target.state.fields[1].name = 'different';
    assert.equal((await runtime.call(projectPath + '/source-previews', conflict)).body.error.code, 'REQUEST_ID_REUSED');
    assert.equal((await runtime.call(projectPath + '/graphs')).body.revision, graph.revision);
  } finally {
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(prefix)) && resolve(directory) !== resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
