import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionChannel } from '../lib/session-channel.js'
import { sessionFixture, session } from './session-fixture.mjs'
const done = async function* () { yield { type: 'text-delta', text: '{"ok":true}' }; yield { type: 'finish', reason: { kind: 'stop' } } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
test('only current session is used, scopes restore after completion and root mismatch is unavailable', async () => {
  const f = sessionFixture(done), c = createSessionChannel(f.ctx)
  assert.equal(createSessionChannel(f.ctx), c)
  assert.equal((await c.support()).available, false)
  assert.equal((await c.support({ sessionId: 'other' })).available, false)
  assert.equal((await c.support({ ...session, projectRoot: 'Z:/missing-owned-fixture' })).available, false)
  const result = await c.request(session, { text: 'first', signal: new AbortController().signal })
  assert.equal(result.sessionId, session.sessionId); assert.equal(result.model, 'test-only'); assert.equal(f.guards.size, 0)
  const assembly = await f.waterfall('system-prompt/assemble', [{}, { agent: f.agent }], async () => ({ tools: ['normal'] }))
  assert.deepEqual(assembly.tools, ['normal'])
  await c.request(session, { text: 'second', signal: new AbortController().signal })
  assert.ok(f.calls.at(-1).messages.some(m => m.content[0].text === 'first'))
})
test('readiness and dispatch refuse busy conversations without cancelling ordinary work', async () => {
  const f = sessionFixture(done), c = createSessionChannel(f.ctx)
  f.agent.status = 'running'
  assert.equal((await c.support(session)).available, false)
  await assert.rejects(c.request(session, { text: 'owned', signal: new AbortController().signal }), /其他请求/)
  assert.equal(f.calls.length, 0); assert.equal(f.agent.status, 'running')
})
test('shared session lease prevents analysis and generation overlap; cancellation preserves queued user messages', async () => {
  let release
  const f = sessionFixture(async function* () { await new Promise(resolve => { release = resolve }); yield* done() }), c = createSessionChannel(f.ctx)
  const controller = new AbortController(), pending = c.request(session, { text: 'owned', signal: controller.signal })
  while (!release) await tick()
  assert.equal(f.guards.size, 1); assert.match([...f.guards][0]({ agent: f.agent }), /不执行工具/)
  assert.equal([...f.guards][0]({ agent: {} }), undefined)
  await assert.rejects(c.request(session, { text: 'overlap', signal: new AbortController().signal }), /其他请求/)
  const user = { id: 'user-next', role: 'user', source: { kind: 'user', rpcId: 'user-next' }, content: [{ type: 'text', text: 'keep' }] }
  f.agent.inbox.nextTurn.push(user)
  controller.abort(new Error('取消 owned'))
  await assert.rejects(pending, /取消/); assert.equal(f.guards.size, 0); await tick(); release()
  // The independent user item is never removed by the cancellation path.
  assert.ok(f.agent.inbox.nextTurn.includes(user) || f.history.includes(user))
})
test('tool calls and overlong output are rejected without leaking guards into next turn', async () => {
  for (const mode of ['tool', 'size']) {
    const f = sessionFixture(async function* () {
      if (mode === 'tool') yield { type: 'tool-call-delta' }
      else yield { type: 'text-delta', text: 'x'.repeat(100) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }), c = createSessionChannel(f.ctx)
    await assert.rejects(c.request(session, { text: 'owned', signal: new AbortController().signal, maxBytes: 10 }), /工具|大小/)
    assert.equal(f.guards.size, 0)
  }
})
test('steered user input is deferred to its ordinary next turn instead of merged or discarded', async () => {
  let release
  const f = sessionFixture(async function* () { await new Promise(resolve => { release = resolve }); yield* done() }), c = createSessionChannel(f.ctx)
  const pending = c.request(session, { text: 'owned', signal: new AbortController().signal })
  while (!release) await tick()
  const user = { id: 'steered', role: 'user', source: { kind: 'user', rpcId: 'steered' }, content: [{ type: 'text', text: 'normal' }] }
  const decision = await f.waterfall('agent/pre-step', [{ agent: f.agent, turn: 1, step: 2, messages: [user] }], async () => ({ kind: 'enter', messages: [user] }))
  assert.deepEqual(decision.messages, []); assert.ok(f.agent.inbox.nextTurn.includes(user))
  // Complete both fixture turns; no extra model call is introduced by the channel.
  release(); await pending; await tick(); release(); await tick()
  assert.ok(f.history.some(message => message.id === 'steered'))
  assert.ok(f.calls.at(-1).tools.length > 0)
})
test('failed hook registration releases partial hooks and session lease', async () => {
  const f = sessionFixture(done), c = createSessionChannel(f.ctx), original = f.ctx.on
  f.ctx.on = (name, ...args) => { if (name === 'agent/pre-step') throw new Error('fixture registration failed'); return original(name, ...args) }
  await assert.rejects(c.request(session, { text: 'owned', signal: new AbortController().signal }), /registration/)
  assert.equal(f.guards.size, 0); assert.equal((await c.support(session)).available, true)
})
