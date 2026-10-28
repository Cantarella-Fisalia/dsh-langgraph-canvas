import type { Project } from '../../../packages/contracts/src/index.ts';
import type { BehaviorAssignment, BehaviorTask, BehaviorSupport, HarnessBehaviorAdapter } from '../../../packages/contracts/src/behavior.ts';
import type { PythonWorker } from './worker.ts';

const terminal = (task: BehaviorTask) => ['review_ready', 'cancelled', 'failed', 'conflicted'].includes(task.status);
function fail(status: number, code: string, message: string): never { throw Object.assign(new Error(message), { status, code }); }
export function createBehaviorTasks(worker: PythonWorker, adapter: HarnessBehaviorAdapter | undefined,
  changed: (project: Project) => void, timeoutMs = 15_000) {
  let closed = false;
  const calls = new Set<AbortController>();
  const launches = new Map<string, Promise<void>>();
  const refreshes = new Map<string, Promise<BehaviorTask>>();
  const key = (project: Project, id: string) => project.id + '/' + id;
  const read = (project: Project, taskId: string) => worker.request<BehaviorTask>('behavior-get', { root: project.root, taskId });
  async function update(project: Project, taskId: string, status: BehaviorTask['status'], message: string, hostTaskId?: string, stopped = false) {
    const value = await worker.request<BehaviorTask>('behavior-update', { root: project.root, taskId, status, message, hostTaskId, stopped });
    if (!closed) changed(project);
    return value;
  }
  async function invoke<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) fail(503, 'CLOSED', '任务监视已关闭。');
    const controller = new AbortController(); calls.add(controller);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([fn(controller.signal), new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('宿主调用已中断；任务是否停止仍需核对。')), { once: true });
        timer = setTimeout(() => { controller.abort(); }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); calls.delete(controller); }
  }
  const handle = (task: BehaviorTask) => ({ taskId: task.id, idempotencyKey: task.id, hostTaskId: task.hostTaskId });
  async function cancelHost(project: Project, task: BehaviorTask) {
    if (!adapter) return task;
    const result = await invoke(signal => adapter.cancel(handle(task), { signal }));
    if (!result || typeof result.acknowledged !== 'boolean') throw new Error('宿主取消回执无效。');
    return update(project, task.id, result.acknowledged ? 'cancelled' : 'cancelling',
      result.message || (result.acknowledged ? '宿主已确认停止，结果不会导入。' : '取消已请求，等待宿主确认停止。'), undefined, result.acknowledged);
  }
  async function refreshCancellation(project: Project, task: BehaviorTask) {
    const state = await invoke(signal => adapter!.getStatus(handle(task), { signal }));
    if (task.hostTaskId && state?.hostTaskId && task.hostTaskId !== state.hostTaskId) throw new Error('取消状态的宿主编号不匹配。');
    if (state && ['succeeded', 'failed', 'cancelled'].includes(state.status)) {
      return update(project, task.id, 'cancelled', '宿主已停止；取消请求优先，未导入结果。', state.hostTaskId, true);
    }
    return cancelHost(project, task);
  }
  async function launch(project: Project, task: BehaviorTask, assignment: BehaviorAssignment) {
    try {
      const receipt = await invoke(signal => adapter!.submit(assignment, { signal }));
      if (!receipt || typeof receipt.hostTaskId !== 'string' || !receipt.hostTaskId.trim() || receipt.hostTaskId.length > 500) throw new Error('宿主未返回有效任务编号。');
      if (closed) return;
      const current = await read(project, task.id);
      const value = await update(project, task.id, current.cancelRequested ? 'cancelling' : 'queued', '宿主已接收，代码只在临时工作区修改。', receipt.hostTaskId);
      if (value.cancelRequested) await cancelHost(project, value);
    } catch (error) {
      if (!closed) await update(project, task.id, 'needs_attention', '提交回执不确定，禁止自动重发；请刷新按幂等键核对：' + (error as Error).message).catch(() => {});
    }
  }
  async function refresh(project: Project, taskId: string): Promise<BehaviorTask> {
    const cached = refreshes.get(key(project, taskId));
    if (cached) return cached;
    const promise = (async () => {
      const task = await read(project, taskId);
      if (terminal(task) || !adapter || launches.has(key(project, taskId))) return task;
      try {
        if (task.cancelRequested) return await refreshCancellation(project, task);
        const result = await invoke(signal => adapter.getStatus(handle(task), { signal }));
        if (!result || !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(result.status)) throw new Error('宿主状态响应无效。');
        if (result.hostTaskId && (typeof result.hostTaskId !== 'string' || result.hostTaskId.length > 500)) throw new Error('宿主任务编号无效。');
        if (task.hostTaskId && result.hostTaskId && task.hostTaskId !== result.hostTaskId) throw new Error('宿主任务编号不匹配。');
        // A cancellation can arrive while a status query is in flight.
        const current = await read(project, taskId);
        if (current.cancelRequested) return await cancelHost(project, current);
        if (result.status === 'succeeded') {
          if (!current.hostTaskId && !result.hostTaskId) throw new Error('成功状态缺少可核对的宿主任务编号。');
          if (result.hostTaskId && !current.hostTaskId) await update(project, taskId, 'running', '已找到宿主任务，正在静态验收结果。', result.hostTaskId);
          const value = await worker.request<BehaviorTask>('behavior-finalize', { root: project.root, taskId });
          if (!closed) changed(project);
          return value;
        }
        return await update(project, taskId, result.status === 'unknown' ? 'needs_attention' : result.status,
          (result.message || ({ queued: '宿主任务排队中。', running: '宿主正在临时工作区实现行为。', failed: '宿主任务失败，原项目未改。',
            cancelled: '宿主已停止任务。', unknown: '未找到确定回执，未重发任务；请接入方核对幂等键。' } as Record<string, string>)[result.status]).slice(0, 2000),
          result.hostTaskId, result.status === 'cancelled');
      } catch (error) {
        if (closed) return task;
        return update(project, taskId, 'needs_attention', '状态暂不可确认，保留副本且不导入：' + (error as Error).message);
      }
    })();
    refreshes.set(key(project, taskId), promise);
    try { return await promise; } finally { refreshes.delete(key(project, taskId)); }
  }
  async function support(sessionId?: string): Promise<BehaviorSupport> {
    if (adapter?.support) {
      try { return await adapter.support(sessionId ? { sessionId } : undefined); }
      catch { return { available: false, mode: 'workspace-task', message: '无法读取 Harness 行为通道，请检查宿主模型设置后刷新。' }; }
    }
    return { available: !!adapter, mode: 'workspace-task', message: adapter ? '节点行为通道已配置；任务仅修改临时副本，结果需再次审阅应用。'
      : 'Harness 节点行为适配器尚未接入。草稿、源码预览和事务可用，暂不能启动真实编码任务。' };
  }
  return {
    support,
    async start(project: Project, body: any) {
      if (body.schemaVersion !== 1 || body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '请明确确认后再启动 Harness 行为任务。');
      const readiness = await support(body.sessionId);
      if (!adapter || !readiness.available) fail(503, 'HARNESS_NOT_CONNECTED', readiness.message);
      if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !/^[\w-]{1,128}$/.test(body.sessionId))) fail(400, 'INVALID_SESSION', '当前会话编号无效。');
      if (typeof body.transactionId !== 'string' || !/^[a-f0-9]{32}$/.test(body.transactionId) || typeof body.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewHash)) {
        fail(400, 'INVALID_BEHAVIOR_REQUEST', '请先生成源码预览并核对审阅摘要。');
      }
      if (readiness.canSubmit === false) {
        const saved = await worker.request<{ tasks: BehaviorTask[] }>('behavior-list', { root: project.root });
        const prior = saved.tasks.find(task => task.requestId === body.requestId && task.transactionId === body.transactionId);
        if (prior) return prior;
        fail(409, 'SESSION_BUSY', readiness.message);
      }
      const prepared = await worker.request<{ task: BehaviorTask; dispatch: boolean; assignment?: BehaviorAssignment }>('behavior-prepare', {
        root: project.root, requestId: body.requestId, transactionId: body.transactionId, reviewHash: body.reviewHash,
      });
      if (prepared.dispatch && prepared.assignment) {
        if (body.sessionId) prepared.assignment.session = { sessionId: body.sessionId, projectRoot: project.root };
        const k = key(project, prepared.task.id);
        const promise = launch(project, prepared.task, prepared.assignment).finally(() => launches.delete(k));
        launches.set(k, promise);
      }
      if (!closed) changed(project);
      return prepared.task;
    },
    async list(project: Project) { return worker.request<{ tasks: BehaviorTask[] }>('behavior-list', { root: project.root }); },
    get: refresh,
    async cancel(project: Project, taskId: string, body: any) {
      if (body.schemaVersion !== 1 || body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '请明确确认取消行为任务。');
      let task = await read(project, taskId);
      if (terminal(task)) return task;
      if (!adapter) fail(503, 'HARNESS_NOT_CONNECTED', '取消需要宿主通道确认；当前不能标为已取消。');
      task = await update(project, taskId, 'cancelling', '已记录取消请求，等待宿主停止。');
      if (launches.has(key(project, taskId))) return task;
      try { return await cancelHost(project, task); }
      catch (error) { return update(project, taskId, 'needs_attention', '取消回执不确定，保留副本：' + (error as Error).message); }
    },
    close() { closed = true; for (const controller of calls) controller.abort(); calls.clear(); },
  };
}
