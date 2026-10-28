/** Test-only native-session surface. Direct LLM/default services deliberately throw. */
import { randomUUID } from 'node:crypto'
export const session = { sessionId: 'fixture-session' }
export function sessionFixture(stream, { cwd = process.cwd() } = {}) {
  const hooks = new Map(), guards = new Set(), events = [], calls = [], history = [], selection = { provider: 'fixture', model: 'test-only' }
  let turn = 0, current
  const on = (name, fn, options) => {
    const list = hooks.get(name) || []; options?.prepend ? list.unshift(fn) : list.push(fn); hooks.set(name, list)
    return () => { const index = list.indexOf(fn); if (index >= 0) list.splice(index, 1) }
  }
  const emit = (name, ...args) => { for (const fn of [...hooks.get(name) || []]) fn(...args) }
  const waterfall = async (name, args, end) => {
    const list = [...hooks.get(name) || []]
    const step = i => i === list.length ? end() : list[i](...args, () => step(i + 1))
    return step(0)
  }
  const tools = { guard(fn) { guards.add(fn); return () => guards.delete(fn) } }
  const ctx = { on, get(name) {
    if (['llm', 'agentDefaultModel'].includes(name)) throw new Error('No independent model access allowed')
    return { tools, agents: { get: id => id === session.sessionId ? agent : undefined }, sessionController: {
      inspect: async id => { if (id !== session.sessionId) throw new Error('Unknown session'); return { meta: { cwd }, events } },
      resolveAgent: async () => ({ agent }),
    } }[name]
  } }
  const event = (type, data) => { const value = { type, data }; events.push(value); emit('session/event', agent.session, value) }
  const agent = { id: session.sessionId, status: 'idle', session: {}, ctx,
    inbox: { nextTurn: [], nextStep: [], splice(target, start, count, inserted) { return this[target === 'next-turn' ? 'nextTurn' : 'nextStep'].splice(start, count, ...inserted) } },
    followup(message) { this.inbox.nextTurn.push(message); queueMicrotask(() => void drive()) },
    cancel() { current?.abort(); },
  }
  async function drive() {
    if (agent.status !== 'idle' || !agent.inbox.nextTurn.length) return
    agent.status = 'running'; const controller = new AbortController(); current = controller; const position = ++turn
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    try {
      const message = agent.inbox.nextTurn.shift()
      emit('agent/inbox/claimed', { agent, message, turn: position })
      const assembly = await waterfall('system-prompt/assemble', [{}, { agent }], async () => ({ tools: [{ name: 'write_file' }] }))
      await waterfall('agent/pre-step', [{ agent, messages: [message], turn: position, step: 1 }], async () => ({ kind: 'enter', messages: [message] }))
      history.push(message)
      const request = { ...selection, tools: assembly.tools, messages: [...history], signal: controller.signal }
      calls.push(request); event('request/header', { header: { config: selection } })
      let text = '', tool = false, reason
      const iterator = stream(request)[Symbol.asyncIterator]()
      for (;;) {
        const chunk = await Promise.race([iterator.next(), aborted]); if (chunk.done) break
        const value = chunk.value
        if (value.type === 'text-delta') text += value.text
        if (value.type === 'block-end' && value.block.type === 'text') text = value.block.text
        if (value.type === 'tool-call-delta') tool = true
        if (value.type === 'finish') reason = value.reason
      }
      if (reason?.kind !== 'stop') { const failure = Object.assign(new Error('provider failed'), { code: reason?.failure?.code || reason?.kind }); throw failure }
      const reply = { id: randomUUID(), role: 'assistant', content: tool ? [{ type: 'tool-call', name: 'write_file' }] : [{ type: 'text', text }], source: selection }
      history.push(reply); event('assistant/message', { turn: position, step: 1, message: reply })
      if (controller.signal.aborted) throw new Error('aborted')
      event('turn/end', { turn: position, reason: { kind: 'completed' } })
    } catch (failure) { event('turn/end', { turn: position, reason: { kind: controller.signal.aborted ? 'aborted' : 'error', error: { code: failure.code } } }) }
    finally { current = undefined; agent.status = 'idle'; queueMicrotask(() => void drive()) }
  }
  return { ctx, agent, events, calls, history, guards, selection, emit, waterfall, session }
}
