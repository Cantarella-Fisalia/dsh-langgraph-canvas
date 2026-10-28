import { createHash } from 'node:crypto';
import type { Project, ProjectAnalysis } from '../../../packages/contracts/src/index.ts';
import { canonicalJson, draftChanges, editableGraph, normalizeEditableGraph, validateEditableGraph } from '../../../packages/contracts/src/editing.ts';
import type { EditReceipt, EditRequestAdapter, EditSupport } from '../../../packages/contracts/src/editing.ts';

function failure(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}
export function createEditRequests(adapter?: EditRequestAdapter) {
  const requests = new Map<string, { fingerprint: string; promise: Promise<EditReceipt> }>();
  function support(): EditSupport {
    return { available: !!adapter, mode: 'request-only',
      message: adapter ? '已接通结构请求接收通道；代码写回仍需后续事务流程。' : 'Harness 编码请求通道尚未接入。当前可编辑本地草稿，暂不能提交修改任务。' };
  }
  async function submit(project: Project, body: any, analyze: () => Promise<ProjectAnalysis>): Promise<EditReceipt> {
    if (body.confirmed !== true) failure(400, 'CONFIRMATION_REQUIRED', '必须由确认按钮明确确认后才能提交结构请求。');
    if (body.schemaVersion !== 1 || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ||
        typeof body.graphId !== 'string' || typeof body.baseRevision !== 'string' || !body.target) {
      failure(400, 'INVALID_EDIT_REQUEST', '结构请求需要版本、请求 ID、图、源码版本和目标草稿。');
    }
    if (!adapter) failure(503, 'HARNESS_NOT_CONNECTED', support().message);
    const key = project.id + '/' + body.requestId;
    const fingerprint = createHash('sha256').update(canonicalJson({ graphId: body.graphId, baseRevision: body.baseRevision, target: body.target })).digest('hex');
    const previous = requests.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) failure(409, 'REQUEST_ID_REUSED', '此请求 ID 已用于其他内容，请重新确认新草稿。');
      return previous.promise;
    }
    if (requests.size >= 500) failure(429, 'REQUEST_LIMIT', '本进程请求数量已达上限，请由接入方检查任务状态。');
    const promise = (async () => {
      const analysis = await analyze();
      const base = analysis.graphs.find(g => g.id === body.graphId);
      if (!base) failure(404, 'GRAPH_NOT_FOUND', '原图不存在，请重新读取。');
      if (base.revision !== body.baseRevision) failure(409, 'SOURCE_CHANGED', '源码已变化，草稿已保留。请核对当前源码后重新创建草稿。');
      const errors = validateEditableGraph(body.target, base);
      if (errors.length) failure(400, 'INVALID_GRAPH_DRAFT', errors.join('\n'));
      const original = editableGraph(base);
      const target = normalizeEditableGraph(body.target);
      const changes = draftChanges(original, target);
      if (!changes.length) failure(400, 'NO_CHANGES', '草稿没有结构修改。');
      const result = await adapter.submit({ schemaVersion: 1, requestId: body.requestId, project, graphId: base.id,
        baseRevision: base.revision, original, target, changes, confirmedAt: new Date().toISOString(), sourceWriteAllowed: false });
      if (!result || typeof result.taskId !== 'string' || !result.taskId.trim() || result.taskId.length > 500) {
        failure(502, 'INVALID_ADAPTER_RECEIPT', '接收通道未返回有效任务编号，请由接入方按请求 ID 核对，草稿已保留。');
      }
      return { requestId: body.requestId, taskId: result.taskId, status: 'accepted' as const,
        message: '结构请求已被接收，源码尚未应用。请在 Harness 中核对后续任务状态。' };
    })();
    requests.set(key, { fingerprint, promise });
    try { return await promise; }
    catch (error) { requests.delete(key); throw error; }
  }
  return { support, submit, clear: () => requests.clear() };
}
