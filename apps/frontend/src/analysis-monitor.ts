import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { AnalysisTask } from '../../../packages/contracts/src/analysis.ts';

export const analysisFinished = (task: AnalysisTask) => ['ready', 'failed', 'cancelled', 'stale'].includes(task.status);
type Ticket = { id: string; revision: string; runtimeId: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Client = Pick<ApiClient, 'base' | 'analysisSnapshot' | 'analysisSupport' | 'startAnalysis' | 'cancelAnalysis'>;
// Survives component recreation when optional sessionStorage is denied. Never an AI result cache.
const automaticAttempts = new Map<string, string[]>();
export interface AnalysisMonitorState {
  task: AnalysisTask | null; restoring: boolean; busy: boolean; synced: boolean;
  blocked: boolean; pending: boolean; error: string;
}
export function analysisSessionStorage(): StorageLike | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

/** View lifetime owns observation only. Tasks and their identity belong to the backend. */
export function createAnalysisMonitor(api: Client, projectId: string, sessionId: string | null, storage?: StorageLike) {
  const key = 'vis4agent:analysis-request:' + JSON.stringify([api.base, projectId, sessionId]);
  const autoKey = 'vis4agent:analysis-auto:' + JSON.stringify([api.base, projectId, sessionId]);
  function attempted(revision: string) {
    let saved: string[] = [];
    try {
      const value: unknown = JSON.parse(storage?.getItem(autoKey) || '[]');
      if (Array.isArray(value)) saved = value.filter(item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)).slice(-16);
    } catch { /* In-page fallback still deduplicates view recreation. */ }
    return [...(automaticAttempts.get(autoKey) || []), ...saved].includes(revision);
  }
  function rememberAttempt(revision: string) {
    const previous = automaticAttempts.get(autoKey) || [];
    const values = [...previous.filter(value => value !== revision), revision].slice(-16);
    automaticAttempts.delete(autoKey); automaticAttempts.set(autoKey, values);
    if (automaticAttempts.size > 128) automaticAttempts.delete(automaticAttempts.keys().next().value!);
    try {
      const saved: unknown = JSON.parse(storage?.getItem(autoKey) || '[]');
      const revisions = Array.isArray(saved) ? saved.filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) : [];
      storage?.setItem(autoKey, JSON.stringify([...new Set([...revisions, ...values])].slice(-16)));
    } catch { /* Optional persistence. */ }
  }
  let ticket: Ticket | undefined;
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    if (value && typeof value.id === 'string' && value.id.length >= 8 && value.id.length <= 100
      && /^[a-f0-9]{64}$/.test(value.revision) && typeof value.runtimeId === 'string') ticket = value;
  } catch { /* Backend discovery still works when storage is unavailable or corrupt. */ }
  let state: AnalysisMonitorState = { task: null, restoring: true, busy: false, synced: false, blocked: false, pending: !!ticket, error: '' };
  const listeners = new Set<() => void>();
  let epoch = 0, connected = false, reading = 0, operation = 0, runtimeId = '';
  const update = (patch: Partial<AnalysisMonitorState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const current = (generation: number) => connected && epoch === generation;
  function save(value: Ticket) { ticket = value; try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Optional receipt recovery. */ } }
  function clear(expected: Ticket | undefined) {
    if (ticket?.id !== expected?.id) return;
    ticket = undefined;
    try { if (JSON.parse(storage?.getItem(key) || 'null')?.id === expected?.id) storage?.removeItem(key); } catch { /* Optional storage. */ }
  }
  async function reconcile(generation = epoch) {
    if (!current(generation) || state.busy || reading === generation) return;
    if (!sessionId) { update({ restoring: false, synced: true }); return; }
    reading = generation;
    const atOperation = operation;
    try {
      const snapshot = await api.analysisSnapshot(projectId, sessionId, ticket?.id);
      if (!current(generation) || operation !== atOperation) return;
      const restarted = !!ticket && ticket.runtimeId !== snapshot.runtimeId;
      if (ticket && (restarted || snapshot.task?.requestId === ticket.id)) clear(ticket);
      runtimeId = snapshot.runtimeId;
      const recovered = !state.synced || state.task?.id !== snapshot.task?.id || state.task?.status !== snapshot.task?.status;
      update({ task: snapshot.task, blocked: snapshot.blockedByOtherSession, pending: !!ticket,
        restoring: false, synced: true, error: restarted ? '宿主任务实例已变化；旧请求未自动重发，请核对后再操作。' : recovered ? '' : state.error });
    } catch (error) {
      if (current(generation) && operation === atOperation) update({ restoring: false, synced: false,
        error: '无法同步后台 AI 任务，暂不提交新任务：' + (error as Error).message });
    } finally { if (reading === generation) reading = 0; }
  }
  async function operate(revision: string, allowCancel: boolean) {
    if (!connected || state.busy || state.restoring) return;
    if (!state.synced) { if (allowCancel) await reconcile(); return; }
    if (state.blocked) return;
    if (!sessionId) { if (allowCancel) update({ error: '请在 Harness 当前会话中打开架构视图。' }); return; }
    if (!allowCancel && state.task && !analysisFinished(state.task)) return;
    const generation = epoch; ++operation; update({ busy: true, error: '' });
    try {
      if (state.task && !analysisFinished(state.task)) {
        const result = await api.cancelAnalysis(projectId, state.task.id);
        if (current(generation)) update({ task: result });
      } else {
        if (!ticket) {
          const ready = await api.analysisSupport(sessionId);
          if (!current(generation)) return;
          if (!ready.available) throw new Error(ready.message);
          save({ id: crypto.randomUUID(), revision, runtimeId });
          update({ pending: true });
        }
        const submitted = ticket!;
        const result = await api.startAnalysis(projectId, submitted.revision, submitted.id, sessionId);
        clear(submitted);
        if (current(generation)) update({ task: result, pending: !!ticket });
      }
    } catch (error) {
      if (current(generation)) update({ error: (error as Error).message, pending: !!ticket });
    } finally {
      if (current(generation)) { update({ busy: false }); void reconcile(generation); }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    connect() {
      const generation = ++epoch; connected = true;
      update({ restoring: true, synced: false, busy: false });
      void reconcile(generation);
      const timer = setInterval(() => void reconcile(generation), 1600);
      return () => { if (epoch === generation) { connected = false; ++epoch; } clearInterval(timer); };
    },
    refresh: () => reconcile(),
    wasAutomaticallyAttempted: attempted,
    click: (revision: string) => operate(revision, true),
    async startAutomatically(revision: string, hasCurrentResult: boolean) {
      if (hasCurrentResult || !sessionId || !/^[a-f0-9]{64}$/.test(revision) || !connected || !state.synced || state.restoring
        || state.busy || state.blocked || state.pending || state.error || attempted(revision)) return;
      if (state.task && (!analysisFinished(state.task) || state.task.revision === revision)) return;
      // Claim before any asynchronous readiness call so StrictMode and simultaneous effects cannot double-submit.
      rememberAttempt(revision);
      await operate(revision, false);
    },
  };
}
