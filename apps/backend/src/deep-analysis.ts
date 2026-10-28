import { randomUUID } from 'node:crypto';
import type { Project, SourceLocation } from '../../../packages/contracts/src/index.ts';
import type { AnalysisContext, AnalysisSource, AnalysisTask, HarnessAnalysisAdapter } from '../../../packages/contracts/src/analysis.ts';
import type { PythonWorker } from './worker.ts';

const terminal = (task: AnalysisTask) => ['ready', 'failed', 'cancelled', 'stale'].includes(task.status);
const fail = (status: number, code: string, message: string): never => { throw Object.assign(new Error(message), { status, code }); };
export function createDeepAnalysis(worker: PythonWorker, adapter: HarnessAnalysisAdapter | undefined, changed: (project: Project) => void) {
  const tasks = new Map<string, { project: Project; requestId: string; task: AnalysisTask; controller: AbortController }>();
  const runtimeId = randomUUID();
  let closed = false;
  const support = async (sessionId?: string, projectRoot?: string) => adapter?.support(sessionId ? { sessionId, projectRoot } : undefined) || { available: false, message: 'AI 会话通道尚未接入当前宿主；静态分析仍可使用。' };
  const update = (entry: typeof tasks extends Map<string, infer V> ? V : never, status: AnalysisTask['status'], message: string) => {
    entry.task.status = status; entry.task.message = message; entry.task.updatedAt = new Date().toISOString();
  };
  async function execute(entry: NonNullable<ReturnType<typeof tasks.get>>) {
    const { task, project, controller } = entry;
    const timer = setTimeout(() => controller.abort(new Error('AI 深度解析超过 5 分钟，已停止。')), 300_000);
    try {
      update(entry, 'reading', '正在建立业务源码与导入索引；文档／示例不会作为业务图提交。');
      const context = await worker.request<AnalysisContext>('deep-context', { root: project.root });
      controller.signal.throwIfAborted();
      if (context.revision !== task.revision) fail(409, 'SOURCE_CHANGED', '源码版本已变化，请刷新后重新确认分析。');
      if (!context.files.length) fail(422, 'NO_ANALYSIS_SOURCE', '当前工作区没有可分析的业务 Python 源码；请核对目录，文档／示例默认排除。');
      const evidence: AnalysisSource[] = [], files = new Set<string>();
      let bytes = 0;
      const readSource = async (request: SourceLocation) => {
        controller.signal.throwIfAborted();
        const cached = evidence.find(e => e.file === request.file && e.line === request.line && e.endLine === request.endLine);
        if (cached) return cached;
        if (evidence.length >= 40) fail(422, 'ANALYSIS_READ_LIMIT', 'AI 已达到 40 段源码读取上限。');
        const value = await worker.request<AnalysisSource>('deep-source', { root: project.root, request, files: context.files });
        controller.signal.throwIfAborted();
        bytes += Buffer.byteLength(value.text);
        if (bytes > 768 * 1024) fail(422, 'ANALYSIS_READ_LIMIT', 'AI 本次读取源码超过 768 KiB，请缩小项目范围。');
        evidence.push(value); files.add(value.file); task.filesRead = files.size;
        return value;
      };
      const payload = await adapter!.analyze(context, { signal: controller.signal, readSource,
        session: task.sessionId ? { sessionId: task.sessionId, projectRoot: project.root } : undefined,
        progress(message) { if (!controller.signal.aborted) update(entry, 'analyzing', message); } });
      controller.signal.throwIfAborted();
      const validated = await worker.request<{ graphs: unknown[]; architecture?: { graphs: unknown[] } }>('deep-validate', { root: project.root, payload, revision: task.revision, evidence });
      controller.signal.throwIfAborted();
      await worker.request('deep-store', { root: project.root, validated });
      controller.signal.throwIfAborted();
      task.graphCount = validated.graphs.length;
      update(entry, 'ready', `AI 解析完成，${task.graphCount} 张推断图，${validated.architecture?.graphs.length || 0} 张图的架构解读已缓存。${validated.architecture ? '解读为 AI 推断。' : '本次未生成架构解读，可明确重新分析。'}原项目源码未修改。`);
      if (!closed) changed(project);
    } catch (error: any) {
      update(entry, controller.signal.aborted ? 'cancelled' : error.code === 'SOURCE_CHANGED' ? 'stale' : 'failed',
        controller.signal.aborted ? controller.signal.reason?.message || 'AI 解析已取消，静态结果保留。' : error.message || 'AI 解析失败，静态结果保留。');
    } finally { clearTimeout(timer); }
  }
  return {
    support,
    snapshot(project: Project, sessionId: string | null, requestId: string | null) {
      if (!sessionId || !/^[\w-]{1,128}$/.test(sessionId)) fail(400, 'INVALID_SESSION', '查询 AI 任务需要当前会话编号。');
      if (requestId !== null && (requestId.length < 8 || requestId.length > 100)) fail(400, 'INVALID_ANALYSIS_REQUEST', '查询任务的请求编号无效。');
      const entries = [...tasks.values()].filter(entry => entry.project.id === project.id);
      const active = entries.find(entry => !terminal(entry.task));
      const own = entries.filter(entry => entry.task.sessionId === sessionId);
      const requested = requestId ? own.find(entry => entry.requestId === requestId) : undefined;
      return { runtimeId, task: (active?.task.sessionId === sessionId ? active : requested || own.at(-1))?.task || null,
        blockedByOtherSession: !!active && active.task.sessionId !== sessionId };
    },
    async start(project: Project, body: any) {
      if (closed) fail(503, 'CLOSED', '分析服务已关闭。');
      if (body.confirmed !== true || body.schemaVersion !== 1) fail(400, 'CONFIRMATION_REQUIRED', '请明确点击 AI；此操作会向当前会话提交只读解读请求。');
      if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !/^[\w-]{1,128}$/.test(body.sessionId))) fail(400, 'INVALID_SESSION', '当前会话编号无效。');
      if (typeof body.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.baseRevision)
        || typeof body.requestId !== 'string' || body.requestId.length < 8 || body.requestId.length > 100) fail(400, 'INVALID_ANALYSIS_REQUEST', 'AI 分析请求版本或编号无效。');
      for (const entry of tasks.values()) {
        if (entry.project.id === project.id && entry.requestId === body.requestId) {
          if (entry.task.revision !== body.baseRevision || entry.task.sessionId !== body.sessionId) fail(409, 'REQUEST_ID_REUSED', '该请求编号已用于另一源码版本或会话。');
          return entry.task;
        }
        if (entry.project.id === project.id && !terminal(entry.task)) {
          if (entry.task.sessionId !== body.sessionId) fail(409, 'PROJECT_ANALYSIS_BUSY', '此项目正在另一会话中解读，请完成后再试。');
          return entry.task;
        }
      }
      const readiness = await support(body.sessionId, project.root);
      if (!readiness.available) fail(503, 'HARNESS_NOT_CONNECTED', readiness.message);
      if (closed) fail(503, 'CLOSED', '分析服务已关闭。');
      // Readiness can await a session read; coalesce another launch admitted meanwhile.
      for (const entry of tasks.values()) {
        if (entry.project.id !== project.id) continue;
        if (entry.requestId === body.requestId) {
          if (entry.task.revision !== body.baseRevision || entry.task.sessionId !== body.sessionId) fail(409, 'REQUEST_ID_REUSED', '该请求编号已用于另一源码版本或会话。');
          return entry.task;
        }
        if (!terminal(entry.task)) {
          if (entry.task.sessionId !== body.sessionId) fail(409, 'PROJECT_ANALYSIS_BUSY', '此项目正在另一会话中解读，请完成后再试。');
          return entry.task;
        }
      }
      if (tasks.size >= 100) {
        for (const [id, entry] of tasks) if (terminal(entry.task)) { tasks.delete(id); break; }
        if (tasks.size >= 100) fail(429, 'ANALYSIS_TASK_LIMIT', '当前分析任务已达上限。');
      }
      const task: AnalysisTask = { id: randomUUID(), revision: body.baseRevision, status: 'queued', message: '已确认，等待分析。',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), filesRead: 0, sessionId: body.sessionId, requestId: body.requestId };
      const entry = { project, requestId: body.requestId, task, controller: new AbortController() };
      tasks.set(task.id, entry); void execute(entry);
      return task;
    },
    get(project: Project, id: string) {
      const entry = tasks.get(id);
      if (!entry || entry.project.id !== project.id) fail(404, 'ANALYSIS_TASK_NOT_FOUND', '未找到本次分析任务；重载宿主后请查看已缓存的图，重新调用模型需再次确认。');
      return entry!;
    },
    cancel(project: Project, id: string, body: any) {
      if (body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '请明确取消 AI 分析。');
      const entry = this.get(project, id);
      if (!terminal(entry.task)) { entry.controller.abort(new Error('AI 解析已取消，原源码未改动。')); update(entry, 'cancelled', 'AI 解析已取消；原源码未改动。'); }
      return entry.task;
    },
    close() { closed = true; for (const entry of tasks.values()) if (!terminal(entry.task)) entry.controller.abort(new Error('插件已卸载，AI 解析已停止。')); },
  };
}
