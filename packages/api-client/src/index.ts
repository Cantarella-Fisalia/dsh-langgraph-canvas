import type { Project, ProjectAnalysis, Layout, SourceDocument, CapabilityDescriptor } from '../../contracts/src/index.ts';
import type { ConfirmEditRequest, EditReceipt, EditSupport } from '../../contracts/src/editing.ts';
import type { SourcePreview, SourceTransaction, ConfirmSourceOperation } from '../../contracts/src/source-preview.ts';
import type { BehaviorTask, BehaviorSupport, ConfirmBehaviorRequest } from '../../contracts/src/behavior.ts';
import type { AnalysisTask, AnalysisTaskSnapshot } from '../../contracts/src/analysis.ts';
export class ApiClient {
  base: string;
  constructor(base = '/api/v1') { this.base = base.replace(/\/$/, ''); }
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(this.base + path, { ...options,
      headers: { accept: 'application/json', ...(options?.body ? { 'content-type': 'application/json' } : {}), ...options?.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'HTTP ' + response.status);
    return body as T;
  }
  openProject(root: string, preferCached = false) { return this.request<{ project: Project; analysis: ProjectAnalysis; reused?: boolean }>('/projects', { method: 'POST', body: JSON.stringify({ root, preferCached }) }); }
  graphs(id: string) { return this.request<ProjectAnalysis>('/projects/' + id + '/graphs'); }
  source(id: string, file: string) { return this.request<SourceDocument>('/projects/' + id + '/source?file=' + encodeURIComponent(file)); }
  layout(id: string, graphId: string) { return this.request<Layout>('/projects/' + id + '/layout?graphId=' + encodeURIComponent(graphId)); }
  saveLayout(id: string, graphId: string, graphRevision: string, layout: Layout) {
    return this.request<Layout>('/projects/' + id + '/layout', { method: 'PUT', body: JSON.stringify({
      graphId, graphRevision, baseRevision: layout.revision, positions: layout.positions,
    }) });
  }
  capabilities() { return this.request<{ capabilities: CapabilityDescriptor[] }>('/capabilities'); }
  editSupport() { return this.request<EditSupport>('/edit-support'); }
  behaviorSupport(sessionId?: string | null) { return this.request<BehaviorSupport>('/behavior-support' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '')); }
  analysisSupport(sessionId?: string | null) { return this.request<{ available: boolean; message: string }>('/analysis-support' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '')); }
  startAnalysis(id: string, baseRevision: string, requestId: string, sessionId?: string) { return this.request<AnalysisTask>('/projects/' + id + '/analysis-tasks', {
    method: 'POST', body: JSON.stringify({ schemaVersion: 1, confirmed: true, baseRevision, requestId, sessionId }),
  }); }
  analysisTask(id: string, taskId: string) { return this.request<AnalysisTask>('/projects/' + id + '/analysis-tasks/' + taskId); }
  analysisSnapshot(id: string, sessionId: string, requestId?: string) {
    const query = new URLSearchParams({ sessionId });
    if (requestId) query.set('requestId', requestId);
    return this.request<AnalysisTaskSnapshot>('/projects/' + id + '/analysis-tasks?' + query, { signal: AbortSignal.timeout(8000) });
  }
  cancelAnalysis(id: string, taskId: string) { return this.request<AnalysisTask>('/projects/' + id + '/analysis-tasks/' + taskId + '/cancel', {
    method: 'POST', body: JSON.stringify({ schemaVersion: 1, confirmed: true }),
  }); }
  behaviorTasks(id: string) { return this.request<{ tasks: BehaviorTask[] }>('/projects/' + id + '/behavior-tasks'); }
  behaviorTask(id: string, taskId: string) { return this.request<BehaviorTask>('/projects/' + id + '/behavior-tasks/' + taskId); }
  startBehavior(id: string, request: ConfirmBehaviorRequest) { return this.request<BehaviorTask>('/projects/' + id + '/behavior-tasks', { method: 'POST', body: JSON.stringify(request) }); }
  cancelBehavior(id: string, taskId: string) { return this.request<BehaviorTask>('/projects/' + id + '/behavior-tasks/' + taskId + '/cancel', {
    method: 'POST', body: JSON.stringify({ schemaVersion: 1, confirmed: true }),
  }); }
  sourcePreview(id: string, request: ConfirmEditRequest) {
    return this.request<SourcePreview>('/projects/' + id + '/source-previews', { method: 'POST', body: JSON.stringify(request) });
  }
  transactions(id: string) { return this.request<{ transactions: SourceTransaction[] }>('/projects/' + id + '/transactions'); }
  transaction(id: string, transactionId: string) { return this.request<SourcePreview>('/projects/' + id + '/transactions/' + transactionId); }
  sourceOperation(id: string, transactionId: string, operation: 'apply' | 'undo' | 'recover', request: ConfirmSourceOperation) {
    return this.request<SourcePreview>('/projects/' + id + '/transactions/' + transactionId + '/' + operation, { method: 'POST', body: JSON.stringify(request) });
  }
  submitEdit(id: string, request: ConfirmEditRequest) {
    return this.request<EditReceipt>('/projects/' + id + '/edit-requests', { method: 'POST', body: JSON.stringify(request) });
  }
  events(id: string) { return new EventSource(this.base + '/projects/' + id + '/events'); }
}
