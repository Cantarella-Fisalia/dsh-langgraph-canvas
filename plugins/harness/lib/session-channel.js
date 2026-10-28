/** Native Harness conversation turns. Never calls llm.stream or selects a different model. */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'

const channels = new WeakMap()
const error = (code, message) => Object.assign(new Error(message), { code, adapterMessage: true })
const turnError = reason => {
  const code = reason?.error?.code || reason?.kind || 'unknown'
  const hint = { INVALID_CREDENTIAL: '当前会话的模型凭据无效，请检查 Harness 账号或 API Key。', INVALID_API_KEY: '当前会话的模型凭据无效，请检查 Harness 账号或 API Key。',
    RATE_LIMIT: '当前会话模型达到频率限制，请稍后重试。', ACCOUNT_QUOTA_EXCEEDED: '当前会话模型额度不足。', CONTEXT_WINDOW_EXCEEDED: '当前会话的上下文已超出模型限制。' }[code]
  return error(code, hint || '会话任务未正常完成：' + code)
}
const service = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const rpc = message => message?.source?.kind === 'user' ? message.source.rpcId : undefined

export function createSessionChannel(ctx) {
  if (channels.has(ctx)) return channels.get(ctx)
  const leases = new Map()
  async function support(session) {
    try {
      if (!session?.sessionId) return { available: false, message: '请先选择 Harness 会话；AI 请求只交给当前会话，不使用独立默认模型。' }
      const controller = service(ctx, 'sessionController')
      if (!controller?.resolveAgent || !controller?.inspect || !service(ctx, 'tools')?.guard || !ctx.on) return { available: false, message: '当前宿主缺少会话或工具隔离接口，暂不能通过本会话运行 AI。' }
      const state = await controller.inspect(session.sessionId)
      if (session.projectRoot && !samePath(await realpath(session.projectRoot), await realpath(state.meta.cwd))) return { available: false, message: '当前会话目录与图的工作区不一致，请切回对应会话。' }
      const agent = service(ctx, 'agents')?.get(session.sessionId)
      if (leases.has(session.sessionId) || agent?.status === 'running' || agent?.inbox?.nextTurn?.length || agent?.inbox?.nextStep?.length) return { available: false, busy: true, message: '当前会话正在处理其他请求，请结束后再点击 AI。' }
      return { available: true, message: '使用当前 Harness 会话的上下文与所选模型；任务及回复会出现在该会话中。' }
    } catch { return { available: false, message: '无法读取当前 Harness 会话，请重新打开该会话后再试。' } }
  }
  async function request(session, { text, signal, requestId = randomUUID(), maxBytes = 2 * 1024 * 1024, onRoute }) {
    signal.throwIfAborted()
    const ready = await support(session)
    if (!ready.available) throw error('SESSION_UNAVAILABLE', ready.message)
    const found = await service(ctx, 'sessionController').resolveAgent(session.sessionId)
    signal.throwIfAborted()
    if (found?.error) throw error('SESSION_UNAVAILABLE', found.error.message)
    const agent = found?.agent
    if (!agent?.followup || !agent.ctx?.on || !agent.cancel || !agent.inbox?.splice || leases.has(session.sessionId)
      || agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) throw error('SESSION_BUSY', '当前会话尚未空闲，未提交解读请求。')
    const lease = { agent, requestId, turn: undefined, active: false, settled: false, route: undefined, output: '', failure: undefined }
    leases.set(session.sessionId, lease)
    return new Promise((resolve, reject) => {
      const stops = []
      let disposed = false
      const cleanup = () => {
        if (disposed) return
        disposed = true
        for (const stop of stops.splice(0)) { try { stop() } catch { /* Release all remaining hooks even if one disposer fails. */ } }
        signal.removeEventListener('abort', abort)
        if (leases.get(session.sessionId) === lease) leases.delete(session.sessionId)
      }
      const finish = failure => {
        if (lease.settled) return
        lease.settled = true; lease.active = false; cleanup()
        if (failure) reject(failure)
        else resolve({ text: lease.output, sessionId: session.sessionId, ...lease.route })
      }
      const abort = () => {
        // Cancel only our owned turn; preserve every other inbox item.
        lease.failure = signal.reason instanceof Error ? signal.reason : error('CANCELLED', '会话任务已取消。')
        for (const [target, list] of [['next-turn', agent.inbox.nextTurn], ['next-step', agent.inbox.nextStep]]) {
          const index = list.findIndex(message => rpc(message) === requestId)
          if (index >= 0) agent.inbox.splice(target, index, 1, [])
        }
        if (lease.active) agent.cancel({ kind: 'user' }, { keepInbox: true })
        else finish(lease.failure)
      }
      try {
      stops.push(agent.ctx.on('agent/inbox/claimed', ({ agent: subject, message, turn }) => {
        if (subject !== agent || rpc(message) !== requestId) return
        lease.turn = turn; lease.active = true
        if (signal.aborted) abort()
      }))
      stops.push(agent.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next()
        return context.agent === agent && lease.active ? { ...assembled, tools: [] } : assembled
      }, { prepend: true }))
      // A monotonic execution guard also blocks tools remembered from earlier conversation turns.
      stops.push(service(agent.ctx, 'tools').guard(exec => exec.agent === agent && lease.active ? 'vis4agent 会话任务仅返回 JSON，不执行工具或修改文件。' : undefined))
      stops.push(agent.ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next()
        if (payload.agent !== agent || payload.turn !== lease.turn || decision.kind === 'reject') return decision
        const other = decision.messages.filter(message => message.source?.kind === 'user' && rpc(message) !== requestId)
        // A user may steer while our reply streams. Keep that message for their next normal turn.
        for (const message of other) agent.followup(message)
        const messages = decision.messages.filter(message => !other.includes(message))
        return { ...decision, messages: lease.output ? [] : messages }
      }, { prepend: true }))
      stops.push(ctx.on('session/event', (owner, event) => {
        if (owner !== agent.session || !lease.active) return
        if (event.type === 'request/header') {
          const config = event.data.header.config
          lease.route = { provider: config.provider, model: config.model }
          onRoute?.(lease.route)
        }
        if (event.type === 'assistant/message' && event.data.turn === lease.turn) {
          const message = event.data.message
          if (event.data.interrupted || message.content.some(block => block.type === 'tool-call')) {
            lease.failure = error('SESSION_INVALID_REPLY', '本会话回复请求了工具或被中断，结果未采用。')
            agent.cancel({ kind: 'user' }, { keepInbox: true }); return
          }
          lease.route = { provider: message.source.provider, model: message.source.model }
          lease.output += message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          if (Buffer.byteLength(lease.output) > maxBytes) {
            lease.failure = error('OUTPUT_LIMIT', '会话输出超过允许大小，结果未采用。')
            agent.cancel({ kind: 'user' }, { keepInbox: true })
          }
        }
        if (event.type === 'turn/end' && event.data.turn === lease.turn) {
          const reason = event.data.reason
          finish(lease.failure || (reason?.kind !== 'completed' ? turnError(reason) : !lease.output ? error('SESSION_EMPTY_REPLY', '本会话没有返回可用文本。') : undefined))
        }
      }, { global: true }))
      stops.push(ctx.on('agent/disposed', ({ agent: subject }) => { if (subject === agent) finish(error('SESSION_CLOSED', '当前会话已关闭，任务停止。')) }, { global: true }))
      signal.addEventListener('abort', abort, { once: true })
        signal.throwIfAborted()
        // Same public Agent entry point used by SessionController.prompt after admission.
        agent.followup({ id: requestId, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: requestId } })
      } catch (failure) { finish(failure) }
    }).then(async value => { await new Promise(done => setTimeout(done, 0)); return value })
  }
  const channel = { support, request }
  channels.set(ctx, channel)
  return channel
}
