import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisMonitor } from './analysis-monitor.ts';
import type { AnalysisTask, AnalysisTaskSnapshot } from '../../../packages/contracts/src/analysis.ts';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
const revision = 'a'.repeat(64);
const task = (requestId = 'existing-request'): AnalysisTask => ({ id: 'existing-task', requestId, sessionId: 'session-1',
  revision, status: 'analyzing', message: 'reading source', filesRead: 2, createdAt: '', updatedAt: '' });
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) || null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('did not settle'); }
function fixture() {
  let backendTask: AnalysisTask | null = null, runtime = 'runtime-one', gets = 0;
  const posts: { revision: string; requestId: string; sessionId?: string }[] = [];
  const api: Pick<ApiClient, 'base' | 'analysisSnapshot' | 'analysisSupport' | 'startAnalysis' | 'cancelAnalysis'> = {
    base: '/fixture',
    async analysisSnapshot() { ++gets; return { runtimeId: runtime, task: backendTask, blockedByOtherSession: false }; },
    async analysisSupport() { return { available: true, message: 'current session' }; },
    async startAnalysis(_project, rev, id, sessionId) { posts.push({ revision: rev, requestId: id, sessionId }); backendTask = task(id); return backendTask; },
    async cancelAnalysis() { return backendTask = { ...backendTask!, status: 'cancelled' }; },
  };
  return { api, posts, gets: () => gets, setTask: (value: AnalysisTask | null) => { backendTask = value; }, restart: () => { runtime = 'runtime-two'; backendTask = null; } };
}
test('initial discovery disables submission and late reads cannot erase a newly acknowledged task', async t => {
  const f = fixture(), initial = deferred<AnalysisTaskSnapshot>();
  const read = f.api.analysisSnapshot; f.api.analysisSnapshot = () => initial.promise;
  const monitor = createAnalysisMonitor(f.api, 'project', 'session-1'); const leave = monitor.connect(); t.after(leave);
  await monitor.click(revision); assert.equal(f.posts.length, 0); assert.equal(monitor.getSnapshot().restoring, true);
  initial.resolve({ runtimeId: 'runtime-one', task: null, blockedByOtherSession: false }); await until(() => monitor.getSnapshot().synced);
  const delayed = deferred<AnalysisTaskSnapshot>(); f.api.analysisSnapshot = () => delayed.promise;
  const poll = monitor.refresh();
  await monitor.click(revision); assert.equal(f.posts.length, 1); assert.ok(monitor.getSnapshot().task);
  delayed.resolve({ runtimeId: 'runtime-one', task: null, blockedByOtherSession: false }); await poll;
  assert.equal(monitor.getSnapshot().task?.id, 'existing-task'); f.api.analysisSnapshot = read;
});
test('uncertain receipt survives iframe recreation; retry reuses the exact request and revision only on click', async t => {
  const f = fixture(), saved = storage(), send = f.api.startAnalysis;
  f.api.startAnalysis = async (_project, rev, id, sessionId) => { f.posts.push({ revision: rev, requestId: id, sessionId }); throw new Error('connection lost'); };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveFirst = first.connect(); t.after(leaveFirst);
  await until(() => first.getSnapshot().synced); await first.click(revision); assert.equal(first.getSnapshot().pending, true); leaveFirst();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveSecond = second.connect(); t.after(leaveSecond);
  await until(() => second.getSnapshot().synced); assert.equal(second.getSnapshot().pending, true); assert.equal(f.posts.length, 1);
  f.api.startAnalysis = send; await second.click('b'.repeat(64));
  assert.equal(f.posts.length, 2); assert.deepEqual(f.posts[1], f.posts[0]); assert.equal(second.getSnapshot().pending, false);
});
test('a task admitted while its POST receipt is pending is recovered on remount without posting', async t => {
  const f = fixture(), saved = storage(), receipt = deferred<AnalysisTask>();
  f.api.startAnalysis = async (_project, rev, id, sessionId) => { f.posts.push({ revision: rev, requestId: id, sessionId }); f.setTask(task(id)); return receipt.promise; };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveFirst = first.connect(); t.after(leaveFirst);
  await until(() => first.getSnapshot().synced); const submit = first.click(revision); await until(() => f.posts.length === 1); leaveFirst();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveSecond = second.connect(); t.after(leaveSecond);
  await until(() => second.getSnapshot().synced); assert.equal(second.getSnapshot().task?.id, 'existing-task'); assert.equal(second.getSnapshot().pending, false);
  receipt.resolve(task(f.posts[0].requestId)); await submit; assert.equal(f.posts.length, 1);
});
test('failed discovery permits only GET retries and never assumes no task is running', async t => {
  const f = fixture(), read = f.api.analysisSnapshot;
  let gets = 0; f.api.analysisSnapshot = async () => { ++gets; throw new Error('offline'); };
  const monitor = createAnalysisMonitor(f.api, 'project', 'session-1'); const leave = monitor.connect(); t.after(leave);
  await until(() => !monitor.getSnapshot().restoring); assert.equal(monitor.getSnapshot().synced, false);
  await monitor.click(revision); assert.equal(gets, 2); assert.equal(f.posts.length, 0);
  f.setTask(task()); f.api.analysisSnapshot = read; await monitor.click(revision);
  assert.equal(monitor.getSnapshot().task?.id, 'existing-task'); assert.equal(f.posts.length, 0);
});
test('host restart discards uncertain local receipt without restarting work', async t => {
  const f = fixture(), saved = storage();
  f.api.startAnalysis = async (_project, rev, id, sessionId) => { f.posts.push({ revision: rev, requestId: id, sessionId }); throw new Error('lost'); };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveFirst = first.connect(); t.after(leaveFirst);
  await until(() => first.getSnapshot().synced); await first.click(revision); leaveFirst(); f.restart();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leaveSecond = second.connect(); t.after(leaveSecond);
  await until(() => second.getSnapshot().synced); assert.equal(second.getSnapshot().pending, false); assert.equal(second.getSnapshot().task, null);
  assert.match(second.getSnapshot().error, /实例已变化/); assert.equal(f.posts.length, 1);
});
test('leaving during readiness never posts late and unavailable storage does not block task recovery', async t => {
  const f = fixture(), ready = deferred<{ available: boolean; message: string }>();
  f.api.analysisSupport = () => ready.promise;
  const first = createAnalysisMonitor(f.api, 'project', 'session-1'); const leaveFirst = first.connect(); t.after(leaveFirst);
  await until(() => first.getSnapshot().synced); const submit = first.click(revision); leaveFirst(); ready.resolve({ available: true, message: '' }); await submit;
  assert.equal(f.posts.length, 0); f.setTask(task());
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} });
  const leaveSecond = second.connect(); t.after(leaveSecond); await until(() => second.getSnapshot().synced);
  assert.equal(second.getSnapshot().task?.id, 'existing-task'); assert.equal(f.posts.length, 0);
});

test('automatic start waits for discovery, reuses cached results and posts only once for a source revision', async t => {
  const f = fixture(); f.api.base = '/auto-initial';
  const monitor = createAnalysisMonitor(f.api, 'project', 'session-1', storage()); const leave = monitor.connect(); t.after(leave);
  await monitor.startAutomatically(revision, false); assert.equal(f.posts.length, 0);
  await until(() => monitor.getSnapshot().synced);
  await monitor.startAutomatically(revision, true); assert.equal(f.posts.length, 0);
  await Promise.all([monitor.startAutomatically(revision, false), monitor.startAutomatically(revision, false)]);
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].sessionId, 'session-1');
  await monitor.startAutomatically(revision, false); assert.equal(monitor.getSnapshot().task?.status, 'analyzing');
});

test('automatic attempts survive view recreation without storage and do not cancel or repost running work', async t => {
  const f = fixture(); f.api.base = '/auto-remount';
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', denied); const leave = first.connect(); t.after(leave);
  await until(() => first.getSnapshot().synced); await first.startAutomatically(revision, false); leave();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', denied); t.after(second.connect());
  await until(() => second.getSnapshot().synced); await second.startAutomatically(revision, false);
  assert.equal(second.getSnapshot().task?.status, 'analyzing'); assert.equal(f.posts.length, 1);
  f.setTask(null); await second.refresh(); await second.startAutomatically(revision, false);
  assert.equal(f.posts.length, 1); assert.equal(second.wasAutomaticallyAttempted(revision), true);
});

test('cancelled and failed analysis never automatically retry, but explicit manual retry still works', async t => {
  const f = fixture(); f.api.base = '/auto-terminal';
  const monitor = createAnalysisMonitor(f.api, 'project', 'session-1', storage()); t.after(monitor.connect());
  await until(() => monitor.getSnapshot().synced);
  for (const status of ['cancelled', 'failed', 'ready', 'stale'] as const) {
    f.setTask({ ...task(), status }); await monitor.refresh(); await monitor.startAutomatically(revision, false);
    assert.equal(f.posts.length, 0);
  }
  await monitor.click(revision); assert.equal(f.posts.length, 1);
});

test('source changes wait for existing work then automatically start the new revision once', async t => {
  const f = fixture(); f.api.base = '/auto-revision'; f.setTask(task());
  const monitor = createAnalysisMonitor(f.api, 'project', 'session-1', storage()); t.after(monitor.connect());
  await until(() => monitor.getSnapshot().synced);
  const next = 'b'.repeat(64);
  await monitor.startAutomatically(next, false); assert.equal(f.posts.length, 0); assert.equal(monitor.getSnapshot().task?.status, 'analyzing');
  f.setTask({ ...task(), status: 'stale' }); await monitor.refresh(); await monitor.startAutomatically(next, false);
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].revision, next);
});

test('uncertain automatic receipts are not resubmitted on remount; manual recovery preserves request identity', async t => {
  const f = fixture(), saved = storage(), send = f.api.startAnalysis; f.api.base = '/auto-receipt';
  f.api.startAnalysis = async (_project, rev, id, sessionId) => { f.posts.push({ revision: rev, requestId: id, sessionId }); throw new Error('connection lost'); };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leave = first.connect(); t.after(leave);
  await until(() => first.getSnapshot().synced); await first.startAutomatically(revision, false); leave();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', saved); t.after(second.connect());
  await until(() => second.getSnapshot().synced); await second.startAutomatically(revision, false);
  assert.equal(f.posts.length, 1); assert.equal(second.getSnapshot().pending, true);
  f.api.startAnalysis = send; await second.click(revision); assert.deepEqual(f.posts[1], f.posts[0]);
});

test('unsupported hosts get one automatic readiness check and no model submission loop', async t => {
  const f = fixture(), saved = storage(); f.api.base = '/auto-unavailable'; let supports = 0;
  f.api.analysisSupport = async () => { supports++; return { available: false, message: 'no session model' }; };
  const first = createAnalysisMonitor(f.api, 'project', 'session-1', saved); const leave = first.connect(); t.after(leave);
  await until(() => first.getSnapshot().synced); await first.startAutomatically(revision, false);
  await first.refresh(); await first.startAutomatically(revision, false); assert.equal(supports, 1); assert.equal(f.posts.length, 0); leave();
  const second = createAnalysisMonitor(f.api, 'project', 'session-1', saved); t.after(second.connect());
  await until(() => second.getSnapshot().synced); await second.startAutomatically(revision, false);
  assert.equal(supports, 1); assert.equal(second.wasAutomaticallyAttempted(revision), true);
});

test('automatic start respects other sessions, failed synchronization, missing sessions and invalid revisions', async t => {
  const f = fixture(); f.api.base = '/auto-guards';
  f.api.analysisSnapshot = async () => ({ runtimeId: 'runtime-one', task: null, blockedByOtherSession: true });
  const blocked = createAnalysisMonitor(f.api, 'project', 'session-1'); t.after(blocked.connect());
  await until(() => blocked.getSnapshot().synced); await blocked.startAutomatically(revision, false); assert.equal(f.posts.length, 0);
  const missing = createAnalysisMonitor(f.api, 'project', null); t.after(missing.connect());
  await missing.startAutomatically(revision, false); assert.equal(missing.getSnapshot().error, '');
  f.api.analysisSnapshot = async () => { throw new Error('offline'); };
  const offline = createAnalysisMonitor(f.api, 'project', 'session-2'); t.after(offline.connect());
  await until(() => !offline.getSnapshot().restoring); await offline.startAutomatically(revision, false); assert.equal(f.posts.length, 0);
  const valid = fixture(); valid.api.base = '/auto-invalid';
  const monitor = createAnalysisMonitor(valid.api, 'project', 'session-1'); t.after(monitor.connect());
  await until(() => monitor.getSnapshot().synced); await monitor.startAutomatically('invalid', false); assert.equal(valid.posts.length, 0);
});

test('automatic attempt history is isolated by project and session and persisted separately from request tickets', async t => {
  const f = fixture(), saved = storage(); f.api.base = '/auto-scope';
  const first = createAnalysisMonitor(f.api, 'one', 'session-1', saved); t.after(first.connect());
  await until(() => first.getSnapshot().synced); await first.startAutomatically(revision, false);
  f.setTask(null);
  const other = createAnalysisMonitor(f.api, 'two', 'session-1', saved); t.after(other.connect());
  await until(() => other.getSnapshot().synced); await other.startAutomatically(revision, false);
  f.setTask(null);
  const session = createAnalysisMonitor(f.api, 'one', 'session-2', saved); t.after(session.connect());
  await until(() => session.getSnapshot().synced); await session.startAutomatically(revision, false);
  assert.equal(f.posts.length, 3); assert.equal(f.posts[2].sessionId, 'session-2');
});
