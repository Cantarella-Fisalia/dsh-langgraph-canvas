import { canonicalJson, draftChanges, editableGraph, normalizeEditableGraph, validateEditableGraph } from '../../../packages/contracts/src/editing.ts';
import type { SourcePreview } from '../../../packages/contracts/src/source-preview.ts';
import type { Project, ProjectAnalysis } from '../../../packages/contracts/src/index.ts';
import type { PythonWorker } from './worker.ts';

function fail(status: number, code: string, message: string): never { throw Object.assign(new Error(message), { status, code }); }

export function createSourcePreviews(worker: PythonWorker) {
  const requests = new Map<string, { fingerprint: string; promise: Promise<SourcePreview> }>();
  return {
    clear() { requests.clear(); },
    async generate(project: Project, body: any, analyze: () => Promise<ProjectAnalysis>): Promise<SourcePreview> {
      if (body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '请先通过确认按钮确认生成临时源码预览。');
      if (body.schemaVersion !== 1 || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ||
          typeof body.graphId !== 'string' || typeof body.baseRevision !== 'string' || !body.target) {
        fail(400, 'INVALID_PREVIEW_REQUEST', '源码预览请求格式无效。');
      }
      const key = project.id + '/' + body.requestId;
      const fingerprint = canonicalJson({ graphId: body.graphId, baseRevision: body.baseRevision, target: body.target });
      // Always check current source; completed reviews now live in the project journal.
      const analysis = await analyze();
      const base = analysis.graphs.find(g => g.id === body.graphId);
      if (!base) fail(404, 'GRAPH_NOT_FOUND', '原图不存在。');
      if (base.revision !== body.baseRevision) fail(409, 'SOURCE_CHANGED', '源码已变化，请重新读取后创建草稿。');
      const previous = requests.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'REQUEST_ID_REUSED', '同一请求 ID 对应了不同草稿。');
        return previous.promise;
      }
      if (requests.size >= 20) fail(429, 'PREVIEW_LIMIT', '正在生成的预览过多，请稍后再试。');
      const errors = validateEditableGraph(body.target, base);
      if (errors.length) fail(400, 'INVALID_GRAPH_DRAFT', errors.join('\n'));
      const target = normalizeEditableGraph(body.target);
      const hasChanges = !!draftChanges(editableGraph(base), target).length;
      const promise = (async () => {
        let preview: Omit<SourcePreview, 'requestId'>;
        try {
          preview = await worker.request('source-preview', { root: project.root, requestId: body.requestId, graphId: base.id, baseRevision: base.revision, target, hasChanges });
        } catch (error: any) {
          if (error.code && error.code !== 'WORKER_ERROR') throw error;
          fail(422, 'SOURCE_PREVIEW_REJECTED', '无法生成源码预览：' + error.message);
        }
        return { ...preview!, requestId: body.requestId };
      })();
      requests.set(key, { fingerprint, promise });
      try { return await promise; }
      finally { requests.delete(key); }
    },
  };
}
