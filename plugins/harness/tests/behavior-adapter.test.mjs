import { sessionFixture, session } from './session-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { createHarnessBehaviorAdapter } from '../lib/behavior-adapter.js'
import { createApplication } from '../../../apps/backend/src/application.ts'
import { editableGraph } from '../../../packages/contracts/src/editing.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const source = 'from typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    question: str\n    answer: str\ndef work(state):\n    return {"answer": "old"}\ng = StateGraph(State)\ng.add_node("work", work)\ng.add_edge(START, "work")\ng.add_edge("work", END)\napp = g.compile()\n'
const edited = source.replace('return {"answer": "old"}', 'return {"answer": state["question"].upper()}')
const context = (stream, cwd) => sessionFixture(stream, { cwd }).ctx
async function removeOwned(path, prefix) {
  const target = resolve(path)
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase())
  assert.ok(basename(target).startsWith(prefix))
  await rm(target, { recursive: true, force: true })
}
async function fixture(stream, { bom = false, crlf = false } = {}) {
  const state = await mkdtemp(join(tmpdir(), 'vis4agent-adapter-test-'))
  const workspace = await mkdtemp(join(tmpdir(), 'vis4agent-behavior-'))
  const id = 'a'.repeat(32)
  await writeFile(join(workspace, '.vis4agent-owner.json'), JSON.stringify({ taskId: id, token: 'b'.repeat(48) }))
  const bytes = Buffer.from((bom ? '\uFEFF' : '') + (crlf ? source.replaceAll('\n', '\r\n') : source))
  await writeFile(join(workspace, 'graph.py'), bytes)
  const assignment = { schemaVersion: 1, session, taskId: id, idempotencyKey: id, workingDirectory: workspace,
    allowedFiles: ['graph.py'], requirements: [{ nodeId: 'work', functionRef: 'work', description: 'question 转大写写入 answer',
      file: 'graph.py', symbol: 'work', affectedNodes: ['work'], kind: 'node' }],
    graph: {}, instruction: 'Only change the work body.', originalProjectWriteAllowed: false, executeProjectAllowed: false }
  const ctx = context(stream), options = { repoRoot, storeRoot: join(state, 'records') }
  const adapter = createHarnessBehaviorAdapter(ctx, options)
  const handle = { taskId: id, idempotencyKey: id }, rpc = { signal: new AbortController().signal }
  return { state, workspace, bytes, assignment, ctx, options, adapter, handle, rpc,
    async until(status) {
      for (let i = 0; i < 150; ++i) {
        const value = await adapter.getStatus(handle, rpc)
        if (value.status === status) return value
        if (['failed', 'succeeded', 'cancelled'].includes(value.status)) assert.fail(JSON.stringify(value))
        await delay(10)
      }
      assert.fail('Adapter did not reach ' + status)
    },
    async close() { await adapter.close(); await removeOwned(workspace, 'vis4agent-behavior-'); await removeOwned(state, 'vis4agent-adapter-test-') },
  }
}
function successfulStream(content, onRequest = () => {}) {
  return async function* (request) {
    onRequest(request)
    const text = JSON.stringify({ files: [{ file: 'graph.py', content }] })
    yield { type: 'text-delta', index: 0, text: text.slice(0, 11) }
    yield { type: 'text-delta', index: 0, text: text.slice(11) }
    // A completed block replaces accumulated deltas; it must not duplicate the JSON.
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('live readiness follows Harness services and current conversation without model I/O', async () => {
  const adapter = createHarnessBehaviorAdapter({ get: () => undefined }, { repoRoot })
  assert.equal((await adapter.support(session)).available, false)
  let calls = 0
  const ctx = context(() => { ++calls; assert.fail('readiness must not call a model') })
  const connected = createHarnessBehaviorAdapter(ctx, { repoRoot })
  assert.equal((await connected.support(session)).available, true)
  assert.match((await connected.support(session)).message, /当前 Harness 会话/)
  await connected.close(); assert.equal((await connected.support(session)).available, false)
  assert.equal(calls, 0)
})

test('durable adapter admission deduplicates; stream uses no tools; BOM and CRLF survive', async () => {
  let calls = 0
  const f = await fixture(successfulStream(edited, request => {
    ++calls; assert.deepEqual(request.tools, []); assert.equal(request.provider, 'fixture')
    assert.equal(request.messages.at(-1).source.kind, 'user')
    assert.equal(JSON.parse(request.messages.at(-1).content[0].text.split('\n\n').at(-1)).files[0].editable, true)
  }), { bom: true, crlf: true })
  try {
    const [a, b] = await Promise.all([f.adapter.submit(f.assignment, f.rpc), f.adapter.submit(f.assignment, f.rpc)])
    assert.deepEqual(a, b); assert.equal(a.hostTaskId, 'vis4agent-' + f.handle.taskId)
    await f.until('succeeded'); assert.equal(calls, 1)
    assert.deepEqual(await readFile(join(f.workspace, 'graph.py')), Buffer.from('\uFEFF' + edited.replaceAll('\n', '\r\n')))
    const restarted = createHarnessBehaviorAdapter(f.ctx, f.options)
    assert.equal((await restarted.getStatus(f.handle, f.rpc)).status, 'succeeded')
    assert.deepEqual(await restarted.submit(f.assignment, f.rpc), a); assert.equal(calls, 1)
    await restarted.close()
    await assert.rejects(f.adapter.submit({ ...f.assignment, instruction: 'changed' }, f.rpc), /幂等键/)
  } finally { await f.close() }
})

test('unexpected file output and in-band provider failures never write generated files', async () => {
  for (const kind of ['path', 'provider', 'truncated']) {
    const f = await fixture(async function* () {
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ files: [{ file: '../outside.py', content: edited }] }) }
      yield { type: 'finish', reason: kind === 'provider' ? { kind: 'error', failure: { code: 'INVALID_CREDENTIAL', message: 'untrusted provider detail' } }
        : { kind: kind === 'truncated' ? 'length' : 'stop' } }
    })
    try {
      await f.adapter.submit(f.assignment, f.rpc)
      const result = await f.until('failed')
      assert.deepEqual(await readFile(join(f.workspace, 'graph.py')), f.bytes)
      assert.doesNotMatch(result.message, /untrusted provider detail/)
      if (kind === 'provider') assert.match(result.message, /凭据/)
    } finally { await f.close() }
  }
})

test('cancellation and unload stop local writes even if the provider ignores abort and replies late', async () => {
  for (const mode of ['cancel', 'unload']) {
    let complete, started = false
    const f = await fixture(() => ({ [Symbol.asyncIterator]() { return {
      next() { started = true; return new Promise(done => { complete = done }) },
      return() { return new Promise(() => {}) },
    } } }))
    try {
      await f.adapter.submit(f.assignment, f.rpc)
      for (let i = 0; i < 100 && !started; ++i) await delay(5)
      assert.ok(started)
      if (mode === 'cancel') assert.equal((await f.adapter.cancel(f.handle, f.rpc)).acknowledged, true)
      else await f.adapter.close()
      assert.equal((await f.adapter.getStatus(f.handle, f.rpc)).status, 'cancelled')
      complete({ done: false, value: { type: 'text-delta', index: 0, text: JSON.stringify({ files: [{ file: 'graph.py', content: edited }] }) } })
      await delay(20)
      assert.deepEqual(await readFile(join(f.workspace, 'graph.py')), f.bytes)
    } finally { await f.close() }
  }
})

test('unknown records never start generation; original directories and changed temporary bytes are refused', async () => {
  let release, started = false, calls = 0
  const f = await fixture(async function* () {
    ++calls; started = true; await new Promise(done => { release = done })
    yield { type: 'text-delta', index: 0, text: JSON.stringify({ files: [{ file: 'graph.py', content: edited }] }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  try {
    assert.equal((await f.adapter.getStatus(f.handle, f.rpc)).status, 'unknown'); assert.equal(calls, 0)
    await assert.rejects(f.adapter.submit({ ...f.assignment, workingDirectory: f.state }, f.rpc), /临时工作区/)
    await f.adapter.submit(f.assignment, f.rpc)
    for (let i = 0; i < 100 && !started; ++i) await delay(5)
    const external = Buffer.concat([f.bytes, Buffer.from('# external copy change\n')])
    await writeFile(join(f.workspace, 'graph.py'), external); release()
    assert.match((await f.until('failed')).message, /其他进程修改/)
    assert.deepEqual(await readFile(join(f.workspace, 'graph.py')), external)
  } finally { release?.(); await f.close() }
})

test('actual adapter through application: explicit task, static result review, confirmed apply and exact undo', async () => {
  const state = await mkdtemp(join(tmpdir(), 'vis4agent-adapter-test-'))
  const project = join(state, 'project'); await mkdir(project); await writeFile(join(project, 'graph.py'), source)
  let calls = 0
  const adapter = createHarnessBehaviorAdapter(context(successfulStream(edited, () => { ++calls }), project), { repoRoot, storeRoot: join(state, 'records') })
  const app = createApplication({ repoRoot, behaviorTaskAdapter: adapter })
  const server = createServer((req, res) => { app.handler(req, res).catch(() => res.end()) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1'
  const call = async (path, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  try {
    assert.equal((await call('/behavior-support?sessionId=' + session.sessionId)).body.available, true)
    const openedResponse = await call('/projects', { root: project })
    assert.equal(openedResponse.status, 200, JSON.stringify(openedResponse.body))
    const opened = openedResponse.body, graph = opened.analysis.graphs[0]
    const path = '/projects/' + opened.project.id, target = editableGraph(graph)
    target.nodes.find(n => n.id === 'work').description = '将 question 转为大写写入 answer。'
    const preview = (await call(path + '/source-previews', { schemaVersion: 1, requestId: 'adapter-e2e-preview', graphId: graph.id,
      baseRevision: graph.revision, target, confirmed: true })).body
    const request = { schemaVersion: 1, requestId: 'adapter-e2e-behavior', sessionId: session.sessionId, transactionId: preview.transaction.id, reviewHash: preview.transaction.reviewHash, confirmed: true }
    assert.equal(calls, 0)
    assert.equal((await call(path + '/behavior-tasks', { ...request, confirmed: false })).status, 400)
    assert.equal(calls, 0)
    const task = (await call(path + '/behavior-tasks', request)).body
    assert.equal((await call(path + '/behavior-tasks', request)).body.id, task.id)
    let result
    for (let i = 0; i < 150; ++i) {
      result = (await call(path + '/behavior-tasks/' + task.id)).body
      if (result.status === 'review_ready') break
      assert.ok(!['failed', 'conflicted'].includes(result.status), JSON.stringify(result)); await delay(10)
    }
    assert.equal(result.status, 'review_ready'); assert.equal(calls, 1)
    assert.equal(await readFile(join(project, 'graph.py'), 'utf8'), source)
    const txPath = path + '/transactions/' + result.resultTransactionId, tx = (await call(txPath)).body
    assert.equal(tx.transaction.kind, 'behavior')
    const confirm = { schemaVersion: 1, confirmed: true, acknowledgedWarnings: true, reviewHash: tx.transaction.reviewHash }
    assert.equal((await call(txPath + '/apply', confirm)).body.transaction.status, 'applied')
    assert.equal(await readFile(join(project, 'graph.py'), 'utf8'), edited)
    assert.equal((await call(txPath + '/undo', confirm)).body.transaction.status, 'undone')
    assert.equal(await readFile(join(project, 'graph.py'), 'utf8'), source)
  } finally {
    await adapter.close(); app.close(); server.closeAllConnections(); await new Promise(done => server.close(done))
    await removeOwned(state, 'vis4agent-adapter-test-')
  }
})

test('stopped process records recover without redispatch; close during admission cannot start a late model call', async () => {
  let calls = 0
  const f = await fixture(successfulStream(edited, () => { ++calls }))
  try {
    await mkdir(f.options.storeRoot, { recursive: true })
    const id = f.handle.taskId
    // PID 0 is deliberately invalid: probe must not accidentally signal a process group.
    const record = { schemaVersion: 1, id, hostTaskId: 'vis4agent-' + id, pid: 2147483647,
      status: 'running', createdAt: new Date().toISOString() }
    await writeFile(join(f.options.storeRoot, id + '.json'), JSON.stringify(record))
    assert.equal((await f.adapter.getStatus(f.handle, f.rpc)).status, 'failed')
    assert.equal((await f.adapter.cancel(f.handle, f.rpc)).acknowledged, true)
    assert.equal(calls, 0)
  } finally { await f.close() }
  const late = await fixture(successfulStream(edited, () => { ++calls }))
  try {
    const admitted = late.adapter.submit(late.assignment, late.rpc)
    await late.adapter.close()
    await admitted
    assert.equal((await late.adapter.getStatus(late.handle, late.rpc)).status, 'cancelled')
    assert.equal(calls, 0)
    assert.deepEqual(await readFile(join(late.workspace, 'graph.py')), late.bytes)
  } finally { await late.close() }
})
