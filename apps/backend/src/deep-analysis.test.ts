import { sessionFixture, session } from '../../../plugins/harness/tests/session-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApplication } from './application.ts';
import { createHarnessAnalysisAdapter } from '../../../plugins/harness/lib/analysis-adapter.js';
import { ApiClient } from '../../../packages/api-client/src/index.ts';
import { createAnalysisMonitor } from '../../frontend/src/analysis-monitor.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const location = (file: string, line: number, endLine = line) => ({ file, line, endLine });
const graphSource = 'from langgraph.graph import StateGraph\nfrom state import State\nfrom nodes import work\ng=StateGraph(State)\ndef register(builder):\n    builder.add_node("work", work)\nregister(g)\n';
const payload = () => ({ graphs: [{ file: 'graph.py', symbol: 'g', scope: '', source: location('graph.py', 4),
  state: { reference: 'State', source: location('state.py', 2, 3), fields: [{ name: 'question', annotation: 'str', source: location('state.py', 3) }] },
  nodes: [{ id: 'work', functionRef: 'work', summary: 'fixture summary', registration: location('graph.py', 6), implementation: location('nodes.py', 1) }], edges: [] }] });
async function setup(t: any, respond: (request: any, call: number) => Promise<unknown> = async (_r, call) => call === 1
  ? { readFiles: [{ file: 'nodes.py', line: 1, endLine: 1 }] } : payload(), source = graphSource) {
  const directory = await mkdtemp(join(tmpdir(), 'vis4agent-deep-'));
  await writeFile(join(directory, 'graph.py'), source);
  await writeFile(join(directory, 'state.py'), 'from typing import TypedDict\nclass State(TypedDict):\n    question: str\n');
  await writeFile(join(directory, 'nodes.py'), 'def work(s): return s\n');
  await mkdir(join(directory, 'docs'));
  await writeFile(join(directory, 'docs/demo.py'), 'from langgraph.graph import StateGraph\ng=StateGraph(dict)\n');
  let calls = 0;
  const native = sessionFixture(async function* (request: any) {
    assert.deepEqual(request.tools, []);
    const result = await respond(request, ++calls);
    yield { type: 'text-delta', index: 0, text: typeof result === 'string' ? result : JSON.stringify(result) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }, { cwd: directory });
  const adapter = createHarnessAnalysisAdapter(native.ctx);
  const app = createApplication({ repoRoot, analysisAdapter: adapter });
  const server = createServer(async (req, res) => { if (!await app.handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1';
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const opened = (await call('/projects', 'POST', { root: directory })).body;
  const route = '/projects/' + opened.project.id;
  const request = { sessionId: session.sessionId, schemaVersion: 1, confirmed: true, baseRevision: opened.analysis.revision, requestId: 'analysis-request-1' };
  const wait = async (id: string) => {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const task = (await call(route + '/analysis-tasks/' + id)).body;
      if (['ready', 'cancelled', 'failed', 'stale'].includes(task.status)) return task;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('task did not finish');
  };
  return { directory, call, route, request, opened, wait, base, calls: () => calls };
}
async function observe(predicate: () => boolean) {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= until) throw new Error('monitor did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
test('view remount recovers the original running task and a completion while away without a second model request', async t => {
  let release: (value: unknown) => void = () => {};
  const f = await setup(t, () => new Promise(resolve => { release = resolve; }));
  t.after(() => release({ graphs: [], message: 'finished while away' }));
  const api = new ApiClient(f.base);
  let starts = 0; const start = api.startAnalysis.bind(api);
  api.startAnalysis = (...args) => { ++starts; return start(...args); };
  const first = createAnalysisMonitor(api, f.opened.project.id, session.sessionId);
  const leaveFirst = first.connect(); t.after(leaveFirst);
  await observe(() => first.getSnapshot().synced);
  await first.click(f.opened.analysis.revision);
  const taskId = first.getSnapshot().task!.id;
  await observe(() => f.calls() === 1); leaveFirst();
  const second = createAnalysisMonitor(api, f.opened.project.id, session.sessionId);
  assert.equal(second.getSnapshot().restoring, true);
  const leaveSecond = second.connect(); t.after(leaveSecond);
  await observe(() => second.getSnapshot().synced);
  assert.equal(second.getSnapshot().task?.id, taskId);
  assert.equal(second.getSnapshot().task?.status, 'analyzing');
  assert.ok(second.getSnapshot().task!.filesRead > 0);
  assert.equal(starts, 1); assert.equal(f.calls(), 1); leaveSecond();
  release({ graphs: [], message: 'finished while away' });
  assert.equal((await f.wait(taskId)).status, 'ready');
  const third = createAnalysisMonitor(api, f.opened.project.id, session.sessionId);
  const leaveThird = third.connect(); t.after(leaveThird);
  await observe(() => third.getSnapshot().synced);
  assert.equal(third.getSnapshot().task?.id, taskId); assert.equal(third.getSnapshot().task?.status, 'ready');
  assert.equal(starts, 1); assert.equal(f.calls(), 1);
});
test('recovered task can be cancelled and discovery never exposes another session task', async t => {
  let release: (value: unknown) => void = () => {};
  const f = await setup(t, () => new Promise(resolve => { release = resolve; }));
  t.after(() => release({ graphs: [] }));
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  await observe(() => f.calls() === 1);
  const foreign = (await f.call(f.route + '/analysis-tasks?sessionId=other-session')).body;
  assert.equal(foreign.task, null); assert.equal(foreign.blockedByOtherSession, true);
  assert.equal((await f.call(f.route + '/analysis-tasks')).status, 400);
  const recovered = createAnalysisMonitor(new ApiClient(f.base), f.opened.project.id, session.sessionId);
  const leave = recovered.connect(); t.after(leave);
  await observe(() => recovered.getSnapshot().synced);
  assert.equal(recovered.getSnapshot().task?.id, started.id);
  await recovered.click(f.opened.analysis.revision);
  assert.equal((await f.wait(started.id)).status, 'cancelled'); assert.equal(f.calls(), 1);
  const snapshot = (await f.call(f.route + '/analysis-tasks?sessionId=' + session.sessionId)).body;
  assert.equal(snapshot.task.id, started.id); assert.equal(snapshot.task.requestId, f.request.requestId);
  const otherProject = (await f.call('/projects', 'POST', { root: join(f.directory, 'docs') })).body;
  assert.equal((await f.call('/projects/' + otherProject.project.id + '/analysis-tasks?sessionId=' + session.sessionId)).body.task, null);
});
test('confirmed actual Harness adapter completes multifile read, caches inferred graph and invalidates on source edits', async t => {
  const f = await setup(t);
  assert.equal(f.calls(), 0);
  assert.equal((await f.call('/analysis-support?sessionId=' + session.sessionId)).body.available, true);
  assert.equal((await f.call(f.route + '/analysis-tasks', 'POST', { ...f.request, confirmed: false })).status, 400);
  assert.equal(f.calls(), 0);
  const started = await f.call(f.route + '/analysis-tasks', 'POST', f.request);
  assert.equal(started.status, 202);
  assert.equal((await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body.id, started.body.id);
  const task = await f.wait(started.body.id);
  assert.equal(task.status, 'ready', task.message);
  assert.equal(task.filesRead, 3);
  const result = (await f.call(f.route + '/graphs')).body;
  const graph = result.graphs.find((g: any) => g.file === 'graph.py');
  assert.equal(graph.discovery.method, 'ai');
  assert.equal(graph.discovery.readOnly, true);
  assert.equal(graph.nodes[0].implementation.file, 'nodes.py');
  assert.equal(result.deepAnalysis.cached, true);
  await f.call(f.route + '/graphs');
  assert.equal(f.calls(), 2);
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), graphSource);
  await writeFile(join(f.directory, 'nodes.py'), 'def work(s): return {}\n');
  const latest = (await f.call(f.route + '/graphs')).body;
  assert.equal(latest.deepAnalysis, undefined);
  assert.equal(latest.graphs.find((g: any) => g.file === 'graph.py').discovery.method, 'static');
  assert.equal(f.calls(), 2);
});
test('out-of-file source evidence is rejected without automatically reading it', async t => {
  const invalid = payload(); invalid.graphs[0].nodes[0].implementation.line = 1000; invalid.graphs[0].nodes[0].implementation.endLine = 1000;
  const f = await setup(t, async () => invalid);
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'failed');
  assert.match(task.message, /不在本次业务索引内/);
  assert.equal(f.calls(), 1);
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), graphSource);
  await assert.rejects(access(join(f.directory, '.vislang/analysis-cache/latest.json')));
});

test('format correction reaches validated cache and later malformed replies preserve it', async t => {
  const f = await setup(t, async (_request, call) => call === 1
    ? { readFiles: [{ file: 'nodes.py', line: 1, endLine: 1 }] }
    : call === 3 ? payload() : JSON.stringify(payload()).slice(0, -1));
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'ready', task.message); assert.equal(f.calls(), 3);
  const cache = join(f.directory, '.vislang/analysis-cache/latest.json');
  const saved = await readFile(cache, 'utf8');
  assert.equal((await f.call(f.route + '/graphs')).body.deepAnalysis.cached, true);
  const retry = (await f.call(f.route + '/analysis-tasks', 'POST', { ...f.request, requestId: 'second-json-request' })).body;
  const failed = await f.wait(retry.id);
  assert.equal(failed.status, 'failed'); assert.match(failed.message, /自动纠正一次/);
  assert.equal(f.calls(), 5); assert.equal(await readFile(cache, 'utf8'), saved);
  assert.equal((await f.call(f.route + '/graphs')).body.deepAnalysis.cached, true);
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), graphSource);
});

test('syntax correction still requires a fresh source read and another model recheck', async t => {
  const f = await setup(t, async (_request, call) => call === 1 ? JSON.stringify(payload()).slice(0, -1) : payload());
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'ready', task.message);
  assert.equal(f.calls(), 3); assert.equal(task.filesRead, 3);
  await access(join(f.directory, '.vislang/analysis-cache/latest.json'));
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), graphSource);
});

test('missing current evidence is re-read and only the revised model reply is cached', async t => {
  const first = payload(); first.graphs[0].nodes[0].summary = 'OLD_CLAIM';
  const revised = payload(); revised.graphs[0].nodes[0].summary = 'RECHECKED_CLAIM';
  const f = await setup(t, async (request, call) => {
    if (call === 1) return first;
    assert.match(request.messages.at(-1).content[0].text, /evidenceCorrection/);
    assert.match(request.messages.at(-1).content[0].text, /def work/);
    return revised;
  });
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'ready', task.message); assert.equal(task.filesRead, 3); assert.equal(f.calls(), 2);
  const result = (await f.call(f.route + '/graphs')).body;
  assert.equal(result.graphs.find((g: any) => g.file === 'graph.py').nodes[0].summary, 'RECHECKED_CLAIM');
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), graphSource);
});

test('source change during evidence recheck makes the task stale without storing a cache', async t => {
  let directory: string;
  const f = await setup(t, async (_request, call) => {
    if (call === 2) await writeFile(join(directory, 'nodes.py'), 'def work(s): return {}\n');
    return payload();
  });
  directory = f.directory;
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'stale'); assert.match(task.message, /源码.*变化/); assert.equal(f.calls(), 2);
  await assert.rejects(access(join(f.directory, '.vislang/analysis-cache/latest.json')));
});
test('cancelled late model output never reaches validation/cache', async t => {
  let release: (value: unknown) => void = () => {};
  let entered: () => void = () => {};
  const entry = new Promise<void>(resolve => { entered = resolve; });
  const f = await setup(t, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  await entry;
  const cancelled = await f.call(f.route + '/analysis-tasks/' + started.id + '/cancel', 'POST', { confirmed: true });
  assert.equal(cancelled.body.status, 'cancelled');
  release(payload());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await f.wait(started.id)).status, 'cancelled');
  await assert.rejects(access(join(f.directory, '.vislang/analysis-cache/latest.json')));
});
test('beginner explanation augments complete static graph without replacing it or enabling model writes', async t => {
  const source = 'from langgraph.graph import StateGraph\nfrom state import State\nfrom nodes import work\ng=StateGraph(State)\ng.add_node("work", work)\n';
  const claim = (text: string, file = 'graph.py', line = 4) => ({ text, evidence: [location(file, line)] });
  const architecture = { schemaVersion: 1, overview: claim('这张图处理一个问题。'), graphs: [{ graphId: 'graph.py::g', purpose: claim('处理输入的问题。'),
    entry: claim('从 State 接收 question。', 'state.py', 3), exit: claim('输出仍需追踪调用入口。'),
    stateFields: [{ name: 'question', role: 'input', meaning: claim('调用者提供的问题。', 'state.py', 3) }],
    nodes: [{ nodeId: 'work', execution: 'function', displayName: claim('传递用户问题', 'nodes.py', 1), summary: claim('返回输入状态。', 'nodes.py', 1), reads: ['question'], writes: [], calls: [] }], conditions: [] }], relationships: [], unresolved: ['没有确认外部调用者。'] };
  const f = await setup(t, async (_request, call) => call === 1 ? { readFiles: [{ file: 'nodes.py', line: 1, endLine: 1 }] } : { graphs: [], architecture }, source);
  const started = (await f.call(f.route + '/analysis-tasks', 'POST', f.request)).body;
  const task = await f.wait(started.id);
  assert.equal(task.status, 'ready', task.message);
  const result = (await f.call(f.route + '/graphs')).body;
  const graph = result.graphs.find((g: any) => g.file === 'graph.py');
  assert.equal(graph.discovery.method, 'static');
  assert.equal(graph.discovery.readOnly, false);
  assert.deepEqual(graph, f.opened.analysis.graphs.find((g: any) => g.file === 'graph.py'));
  assert.equal(result.architecture.graphs[0].stateFields[0].meaning.text, '调用者提供的问题。');
  assert.equal(result.architecture.graphs[0].nodes[0].displayName.text, '传递用户问题');
  assert.equal(result.architecture.revision, result.revision);
  await f.call(f.route + '/graphs');
  assert.equal(f.calls(), 2);
  assert.equal(await readFile(join(f.directory, 'graph.py'), 'utf8'), source);
  await writeFile(join(f.directory, 'nodes.py'), 'def work(s): return {}\n');
  assert.equal((await f.call(f.route + '/graphs')).body.architecture, undefined);
});
