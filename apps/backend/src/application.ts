import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpath, stat, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { resolve, join, basename, isAbsolute, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PythonWorker } from './worker.ts';
import { createEditRequests } from './edit-requests.ts';
import { createSourcePreviews } from './source-previews.ts';
import { createBehaviorTasks } from './behavior-tasks.ts';
import { createDeepAnalysis } from './deep-analysis.ts';
import type { HarnessAnalysisAdapter } from '../../../packages/contracts/src/analysis.ts';
import type { HarnessBehaviorAdapter } from '../../../packages/contracts/src/behavior.ts';
import type { EditRequestAdapter } from '../../../packages/contracts/src/editing.ts';
import { validateAnalysis } from '../../../packages/contracts/src/validation.ts';
import type { Project, ProjectAnalysis, Layout, SourceDocument, CapabilityDescriptor } from '../../../packages/contracts/src/index.ts';

class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const EMPTY_LAYOUT = { schemaVersion: 1 as const, positions: {} };
const safePath = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
};
function send(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
async function jsonBody(req: IncomingMessage): Promise<any> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', '请求需要 application/json。');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    size += Buffer.byteLength(chunk);
    if (size > 1_000_000) throw new HttpError(413, 'BODY_TOO_LARGE', '请求过大。');
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'INVALID_JSON', '请求不是有效的 JSON 对象。'); }
}
interface ProjectRecord {
  invalidation: number; verifiedAt: number; dirty: boolean;
  project: Project; analysis?: ProjectAnalysis; watcher?: FSWatcher; timer?: NodeJS.Timeout;
  listeners: Set<ServerResponse>; sequence: number; busy?: Promise<ProjectAnalysis>;
  eventTimer?: NodeJS.Timeout; history: { id: string; data: string }[]; layoutQueue: Promise<void>;
}
export interface ApplicationOptions {
  repoRoot: string;
  pythonCommand?: string;
  apiPrefix?: string;
  allowedOrigins?: string[];
  editRequestAdapter?: EditRequestAdapter;
  behaviorTaskAdapter?: HarnessBehaviorAdapter;
  behaviorRequestTimeoutMs?: number;
  analysisAdapter?: HarnessAnalysisAdapter;
}
export function createApplication(options: ApplicationOptions) {
  const prefix = options.apiPrefix || '/api/v1';
  const worker = new PythonWorker(options.repoRoot, options.pythonCommand);
  const records = new Map<string, ProjectRecord>();
  const editRequests = createEditRequests(options.editRequestAdapter);
  const sourcePreviews = createSourcePreviews(worker);
  const origins = new Set(options.allowedOrigins || ['http://127.0.0.1:5173', 'http://localhost:5173', 'dsh-app://app']);
  let disposed = false;
  const behaviorTasks = createBehaviorTasks(worker, options.behaviorTaskAdapter, project => {
    const record = records.get(project.id); if (record) event(record, 'behavior.changed');
  }, options.behaviorRequestTimeoutMs);
  const deepAnalysis = createDeepAnalysis(worker, options.analysisAdapter, project => {
    const record = records.get(project.id); if (record) { record.dirty = true; ++record.invalidation; event(record, 'project.changed'); }
  });

  function event(record: ProjectRecord, type: string, revision?: string) {
    const sequence = ++record.sequence;
    const id = record.project.id + ':' + sequence;
    const data = JSON.stringify({ schemaVersion: 1, id, sequence, projectId: record.project.id, type, revision });
    record.history.push({ id, data }); if (record.history.length > 100) record.history.shift();
    for (const res of record.listeners) res.write('id: ' + id + '\ndata: ' + data + '\n\n');
  }
  async function analyze(record: ProjectRecord) {
    if (record.busy) return record.busy;
    const invalidation = record.invalidation;
    record.busy = worker.request<unknown>('analyze', { root: record.project.root }).then(async (value) => {
      const analysis = validateAnalysis(value);
      try {
        const cached = await worker.request<{ graphs: ProjectAnalysis['graphs']; revision: string; message: string; architecture?: ProjectAnalysis['architecture'] } | null>('deep-cache', { root: record.project.root, revision: analysis.revision });
        if (cached) {
          const verified = validateAnalysis({ ...analysis, graphs: cached.graphs });
          const keep = new Map(analysis.graphs.map(graph => [graph.id, graph]));
          for (const graph of verified.graphs) {
            const existing = keep.get(graph.id);
            if (!existing || existing.discovery?.completeness === 'partial') keep.set(graph.id, graph);
          }
          analysis.graphs = [...keep.values()].sort((a, b) => Number(a.discovery?.category === 'reference') - Number(b.discovery?.category === 'reference'));
          analysis.deepAnalysis = { revision: cached.revision, graphCount: cached.graphs.length, cached: true, message: cached.message };
          if (cached.architecture) analysis.architecture = cached.architecture;
        }
      } catch {
        analysis.diagnostics.push({ code: 'AI_CACHE_UNAVAILABLE', severity: 'warning', message: 'AI 分析缓存无法使用，当前保留静态结果；可明确重新分析。' });
      }
      const previous = record.analysis?.revision;
      record.analysis = analysis;
      record.verifiedAt = Date.now(); record.dirty = record.invalidation !== invalidation;
      if (previous && previous !== analysis.revision) event(record, 'project.changed', analysis.revision);
      return analysis;
    }).finally(() => { record.busy = undefined; });
    return record.busy;
  }
  async function layoutPath(record: ProjectRecord) {
    const dir = join(record.project.root, '.vislang');
    await mkdir(dir, { recursive: true });
    if (!safePath(record.project.root, await realpath(dir))) throw new HttpError(400, 'UNSAFE_LAYOUT_PATH', '布局目录不能指向项目之外。');
    const file = join(dir, 'layout.json');
    try {
      if (!safePath(record.project.root, await realpath(file))) throw new HttpError(400, 'UNSAFE_LAYOUT_PATH', '布局文件不能指向项目之外。');
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    return file;
  }
  async function readLayouts(record: ProjectRecord) {
    const file = await layoutPath(record);
    try {
      const content = await readFile(file, 'utf8');
      const value = JSON.parse(content.replace(/^\uFEFF/, ''));
      if (value.schemaVersion !== 1 || !value.graphs || typeof value.graphs !== 'object' || Array.isArray(value.graphs)) throw new Error('Unsupported layout format');
      return { value, revision: hash(content) };
    } catch (e: any) {
      if (e.code === 'ENOENT') return { value: { schemaVersion: 1, graphs: {} as Record<string, unknown> }, revision: 'empty' };
      if (e instanceof HttpError) throw e;
      throw new HttpError(409, 'INVALID_LAYOUT', '已有布局文件无法读取，未覆盖：' + e.message);
    }
  }
  function find(id: string) {
    const record = records.get(id);
    if (!record) throw new HttpError(404, 'PROJECT_NOT_FOUND', '项目未打开，请重新打开项目目录。');
    return record;
  }
  const capabilities: CapabilityDescriptor[] = [
    { id: 'mcp', kind: 'mcp', title: 'MCP', description: '外部服务与能力发现', scopes: ['development', 'runtime'], status: 'not_configured' },
    { id: 'rag', kind: 'rag', title: 'RAG', description: '知识检索与索引', scopes: ['development', 'runtime'], status: 'not_configured' },
    { id: 'tools', kind: 'tool', title: 'Tools', description: '函数与 API 工具', scopes: ['development', 'runtime'], status: 'not_configured' },
    { id: 'skills', kind: 'skill', title: 'Skills', description: '任务说明与资源', scopes: ['development', 'runtime'], status: 'not_configured' },
  ];
  async function handler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
    try {
      if (disposed) throw new HttpError(503, 'CLOSED', '服务已关闭。');
      const origin = req.headers.origin;
      const ownOrigin = 'http://' + req.headers.host;
      if (origin && origin !== ownOrigin && !origins.has(origin)) throw new HttpError(403, 'ORIGIN_DENIED', '不允许此请求来源。');
      const route = url.pathname.slice(prefix.length);
      if (route === '/health' && req.method === 'GET') {
        send(res, 200, { ok: true, schemaVersion: 1, stage: 'p2-transactions', readOnly: false, sourceWrites: 'confirmed-transactions-only' }); return true;
      }
      if (route === '/capabilities' && req.method === 'GET') { send(res, 200, { capabilities }); return true; }
      if (route === '/edit-support' && req.method === 'GET') { send(res, 200, editRequests.support()); return true; }
      if (route === '/behavior-support' && req.method === 'GET') { send(res, 200, await behaviorTasks.support(url.searchParams.get('sessionId') || undefined)); return true; }
      if (route === '/analysis-support' && req.method === 'GET') { send(res, 200, await deepAnalysis.support(url.searchParams.get('sessionId') || undefined)); return true; }
      if (route === '/projects' && req.method === 'GET') {
        send(res, 200, { projects: [...records.values()].map(r => r.project) }); return true;
      }
      if (route === '/projects' && req.method === 'POST') {
        const body = await jsonBody(req);
        if (typeof body.root !== 'string' || !isAbsolute(body.root)) throw new HttpError(400, 'INVALID_ROOT', '请输入项目的绝对目录。');
        let root: string;
        try { root = await realpath(body.root); if (!(await stat(root)).isDirectory()) throw new Error(); }
        catch { throw new HttpError(400, 'INVALID_ROOT', '项目目录不存在或不可访问。'); }
        const id = hash(root).slice(0, 24);
        if (!records.has(id)) {
          const record: ProjectRecord = { project: { id, name: basename(root), root }, sequence: 0,
            invalidation: 0, verifiedAt: 0, dirty: true,
            listeners: new Set(), history: [], layoutQueue: Promise.resolve() };
          records.set(id, record);
          try {
            record.watcher = watch(root, { recursive: true }, (_event, filename) => {
              const file = filename?.toString();
              if (file && !file.endsWith('.py')) return;
              if (file?.split(/[\\/]/).some(part => part.startsWith('.') || ['node_modules', '__pycache__', 'venv'].includes(part))) return;
              record.dirty = true; ++record.invalidation;
              if (record.timer) clearTimeout(record.timer);
              record.timer = setTimeout(() => { analyze(record).catch(() => event(record, 'project.changed')); }, 400);
            });
            record.watcher.on('error', () => { record.dirty = true; ++record.invalidation; record.watcher?.close(); record.watcher = undefined; });
          } catch { /* Manual refresh remains available on unsupported filesystems. */ }
        }
        const record = find(id);
        if (body.preferCached === true && record.analysis && record.watcher && !record.dirty && !record.busy && Date.now() - record.verifiedAt < 3000) {
          send(res, 200, { project: record.project, analysis: record.analysis, reused: true }); return true;
        }
        await worker.request('transaction-list', { root: record.project.root });
        const analysis = await analyze(record);
        send(res, 200, { project: record.project, analysis }); return true;
      }
      const analysisRoute = /^\/projects\/([^/]+)\/analysis-tasks(?:\/([a-f0-9-]{36})(?:\/(cancel))?)?$/.exec(route);
      if (analysisRoute) {
        const record = find(decodeURIComponent(analysisRoute[1])), id = analysisRoute[2];
        if (req.method === 'GET' && !id) { send(res, 200, deepAnalysis.snapshot(record.project, url.searchParams.get('sessionId'), url.searchParams.get('requestId'))); return true; }
        if (req.method === 'POST' && !id) { send(res, 202, await deepAnalysis.start(record.project, await jsonBody(req))); return true; }
        if (req.method === 'GET' && id && !analysisRoute[3]) { send(res, 200, deepAnalysis.get(record.project, id).task); return true; }
        if (req.method === 'POST' && id && analysisRoute[3] === 'cancel') { send(res, 200, deepAnalysis.cancel(record.project, id, await jsonBody(req))); return true; }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的 AI 分析操作。');
      }
      const behaviorRoute = /^\/projects\/([^/]+)\/behavior-tasks(?:\/([a-f0-9]{32})(?:\/(cancel))?)?$/.exec(route);
      if (behaviorRoute) {
        const record = find(decodeURIComponent(behaviorRoute[1]));
        const taskId = behaviorRoute[2];
        if (req.method === 'GET' && !behaviorRoute[3]) {
          send(res, 200, taskId ? await behaviorTasks.get(record.project, taskId) : await behaviorTasks.list(record.project)); return true;
        }
        if (req.method === 'POST' && !taskId) {
          send(res, 202, await behaviorTasks.start(record.project, await jsonBody(req))); return true;
        }
        if (req.method === 'POST' && taskId && behaviorRoute[3] === 'cancel') {
          send(res, 200, await behaviorTasks.cancel(record.project, taskId, await jsonBody(req))); return true;
        }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '行为任务接口不支持此操作。');
      }
      const transactionRoute = /^\/projects\/([^/]+)\/transactions(?:\/([a-f0-9]{32})(?:\/(apply|undo|recover))?)?$/.exec(route);
      if (transactionRoute) {
        const record = find(decodeURIComponent(transactionRoute[1]));
        const transactionId = transactionRoute[2], operation = transactionRoute[3];
        const params = { root: record.project.root, transactionId };
        if (req.method === 'GET' && !operation) {
          send(res, 200, await worker.request(transactionId ? 'transaction-get' : 'transaction-list', params)); return true;
        }
        if (req.method === 'POST' && transactionId && operation) {
          const body = await jsonBody(req);
          if (body.schemaVersion !== 1 || body.confirmed !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', '请通过明确确认按钮执行源码操作。');
          if (typeof body.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewHash)) throw new HttpError(400, 'REVIEW_REQUIRED', '请先打开差异并取得审阅摘要。');
          const result = await worker.request('transaction-execute', { ...params, operation, confirmed: true,
            reviewHash: body.reviewHash, acknowledgedWarnings: body.acknowledgedWarnings === true });
          sourcePreviews.clear();
          await analyze(record);
          send(res, 200, result); return true;
        }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '事务接口不支持此操作。');
      }
      const match = /^\/projects\/([^/]+)(?:\/(graphs|source|layout|events|edit-requests|source-previews))?$/.exec(route);
      if (!match) throw new HttpError(404, 'NOT_FOUND', '接口不存在。');
      const record = find(decodeURIComponent(match[1]));
      const resource = match[2];
      if (resource === 'source-previews' && req.method === 'POST') {
        send(res, 200, await sourcePreviews.generate(record.project, await jsonBody(req), () => analyze(record))); return true;
      }
      if (resource === 'edit-requests' && req.method === 'POST') {
        const body = await jsonBody(req);
        send(res, 202, await editRequests.submit(record.project, body, () => analyze(record))); return true;
      }
      if (resource === 'graphs' && req.method === 'GET') {
        send(res, 200, await analyze(record)); return true;
      }
      if (resource === 'source' && req.method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file || !file.endsWith('.py') || !safePath(record.project.root, resolve(record.project.root, file))) {
          throw new HttpError(400, 'INVALID_SOURCE', '只能读取项目内 Python 源码。');
        }
        let target: string;
        try { target = await realpath(resolve(record.project.root, file)); }
        catch { throw new HttpError(404, 'SOURCE_NOT_FOUND', '源码文件不存在。'); }
        if (!safePath(record.project.root, target)) throw new HttpError(400, 'INVALID_SOURCE', '源码不能指向项目之外。');
        send(res, 200, await worker.request<SourceDocument>('source', { root: record.project.root, file })); return true;
      }
      if (resource === 'layout' && req.method === 'GET') {
        const graphId = url.searchParams.get('graphId');
        if (!graphId) throw new HttpError(400, 'GRAPH_REQUIRED', '需要 graphId。');
        const stored = await readLayouts(record);
        send(res, 200, { ...EMPTY_LAYOUT, ...(stored.value.graphs[graphId] || {}), revision: stored.revision }); return true;
      }
      if (resource === 'layout' && req.method === 'PUT') {
        const body = await jsonBody(req);
        if (typeof body.graphId !== 'string' || typeof body.baseRevision !== 'string' ||
            !body.positions || typeof body.positions !== 'object' || Array.isArray(body.positions)) {
          throw new HttpError(400, 'INVALID_LAYOUT', '布局需要 graphId、baseRevision 和 positions。');
        }
        const operation = record.layoutQueue.then(async () => {
          const analysis = await analyze(record);
          const graph = analysis.graphs.find(g => g.id === body.graphId);
          if (!graph) throw new HttpError(404, 'GRAPH_NOT_FOUND', '图不存在。');
          if (body.graphRevision !== analysis.revision) throw new HttpError(409, 'SOURCE_CHANGED', '源码已变化，请刷新后重试。');
          const ids = new Set(graph.nodes.map(n => n.id));
          const positions = Object.create(null);
          for (const [key, value] of Object.entries(body.positions) as [string, any][]) {
            if (!ids.has(key) || !value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1e7 || Math.abs(value.y) > 1e7) {
              throw new HttpError(400, 'INVALID_POSITION', '节点位置无效。');
            }
            positions[key] = { x: value.x, y: value.y };
          }
          const stored = await readLayouts(record);
          if (body.baseRevision !== stored.revision) throw new HttpError(409, 'LAYOUT_CONFLICT', '布局已被其他窗口修改，请重新加载。');
          stored.value.graphs[body.graphId] = { schemaVersion: 1, positions };
          const content = JSON.stringify(stored.value, null, 2) + '\n';
          const file = await layoutPath(record);
          const temporary = file + '.' + randomUUID() + '.tmp';
          try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, file); }
          finally { await unlink(temporary).catch(() => {}); }
          event(record, 'layout.saved', analysis.revision);
          return { schemaVersion: 1, positions, revision: hash(content) } as Layout;
        });
        record.layoutQueue = operation.then(() => {}, () => {});
        send(res, 200, await operation); return true;
      }
      if (resource === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        const last = req.headers['last-event-id'];
        const index = typeof last === 'string' ? record.history.findIndex(e => e.id === last) : -1;
        if (index >= 0) for (const item of record.history.slice(index + 1)) res.write('id: ' + item.id + '\ndata: ' + item.data + '\n\n');
        else event(record, 'project.changed', record.analysis?.revision);
        record.listeners.add(res);
        // Initial event makes a missed history window recover via GET /graphs.
        if (index < 0) {
          const latest = record.history.at(-1)!;
          res.write('id: ' + latest.id + '\ndata: ' + latest.data + '\n\n');
        }
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
        res.on('close', () => { clearInterval(heartbeat); record.listeners.delete(res); });
        return true;
      }
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '此资源不支持该操作。');
    } catch (error: any) {
      if (!res.headersSent) send(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '服务错误。' } });
      else res.end();
      return true;
    }
  }
  function close() {
    disposed = true;
    behaviorTasks.close();
    deepAnalysis.close();
    editRequests.clear();
    sourcePreviews.clear();
    for (const record of records.values()) {
      record.watcher?.close(); clearTimeout(record.timer);
      for (const res of record.listeners) res.end();
    }
    worker.close();
  }
  return { handler, close };
}
