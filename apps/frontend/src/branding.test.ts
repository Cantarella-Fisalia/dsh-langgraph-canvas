import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleStorage } from './legacy-storage.ts';
import { readViewMode, saveViewMode } from './view-mode.ts';
import { environmentValue, behaviorMarker, hostTaskMatches } from '../../../scripts/runtime/brand.mjs';
import { resolvePythonCommand } from '../../../scripts/runtime/python.mjs';
import { createAnalysisMonitor } from './analysis-monitor.ts';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { AnalysisTask } from '../../../packages/contracts/src/analysis.ts';
const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
test('existing professional preference is read and new preference takes precedence without rewriting old data', () => {
  const storage = memory(); storage.setItem('vis4agent:view-mode', 'professional');
  assert.equal(readViewMode(storage), 'professional');
  assert.equal(saveViewMode('standard', storage), true);
  assert.equal(readViewMode(storage), 'standard');
  assert.equal(storage.getItem('vis4agent:view-mode'), 'professional');
  assert.equal(storage.getItem('langcontour:view-mode'), 'standard');
});
test('legacy drafts can be explicitly cleared without coming back through fallback', () => {
  const storage = memory(), current = 'langcontour:structure-draft:p:g', old = 'vis4agent:structure-draft:p:g';
  storage.setItem(old, '{"requestId":"kept"}');
  const compatible = compatibleStorage(storage)!;
  assert.equal(compatible.getItem(current), '{"requestId":"kept"}');
  compatible.setItem(current, '{"requestId":"new"}');
  compatible.removeItem(current);
  assert.equal(compatible.getItem(current), null); assert.equal(storage.getItem(old), null);
});
test('legacy API namespaces in cache keys are translated without renaming the workspace directory', () => {
  const storage = memory();
  storage.setItem('vis4agent:workspace-view:v1:["/vis4agent/api/v1","E:/projects/langcontour"]', 'snapshot');
  assert.equal(compatibleStorage(storage)!.getItem('langcontour:workspace-view:v1:["/langcontour/api/v1","E:/projects/langcontour"]'), 'snapshot');
  storage.setItem('unrelated:setting', 'kept');
  assert.equal(compatibleStorage(storage)!.getItem('unrelated:setting'), 'kept');
});
test('old uncertain analysis receipts are recovered without automatic resubmission and manual recovery reuses the same ID', async t => {
  const storage = memory(), revision = 'a'.repeat(64), posts: string[] = [];
  const oldKey = 'vis4agent:analysis-request:' + JSON.stringify(['/vis4agent/api/v1', 'project', 'session']);
  storage.setItem(oldKey, JSON.stringify({ id: 'old-request-id', revision, runtimeId: 'runtime' }));
  let backendTask: AnalysisTask | null = null;
  const api: Pick<ApiClient, 'base' | 'analysisSnapshot' | 'analysisSupport' | 'startAnalysis' | 'cancelAnalysis'> = {
    base: '/langcontour/api/v1',
    async analysisSnapshot() { return { runtimeId: 'runtime', task: backendTask, blockedByOtherSession: false }; },
    async analysisSupport() { return { available: true, message: '' }; },
    async startAnalysis(_project, source, id) { posts.push(id); return backendTask = { id: 'task', requestId: id, revision: source, status: 'queued', message: '', createdAt: '', updatedAt: '', filesRead: 0 }; },
    async cancelAnalysis() { throw new Error('Must not cancel'); },
  };
  const monitor = createAnalysisMonitor(api, 'project', 'session', storage); t.after(monitor.connect());
  for (let i = 0; !monitor.getSnapshot().synced && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(monitor.getSnapshot().pending, true);
  await monitor.startAutomatically(revision, false); assert.deepEqual(posts, []);
  await monitor.click(revision); assert.deepEqual(posts, ['old-request-id']);
  assert.equal(storage.getItem(oldKey), null);
});
test('new environment names win while old Python settings and explicit overrides still work', () => {
  assert.equal(environmentValue('PYTHON', { LANGCONTOUR_PYTHON: ' new-python ', VIS4AGENT_PYTHON: 'old-python' }), 'new-python');
  assert.equal(resolvePythonCommand(undefined, { env: { VIS4AGENT_PYTHON: 'old-python' }, exists: () => false }), 'old-python');
  assert.equal(resolvePythonCommand('explicit', { env: { LANGCONTOUR_PYTHON: 'new-python' }, exists: () => false }), 'explicit');
});
test('legacy task identifiers and markers remain exact and do not accept unrelated workspaces or task IDs', () => {
  assert.equal(behaviorMarker('langcontour-behavior-abc'), '.langcontour-owner.json');
  assert.equal(behaviorMarker('vis4agent-behavior-abc'), '.vis4agent-owner.json');
  assert.equal(behaviorMarker('unowned-behavior-abc'), undefined);
  assert.equal(hostTaskMatches('vis4agent-id', 'id'), true);
  assert.equal(hostTaskMatches('langcontour-id', 'id'), true);
  assert.equal(hostTaskMatches('vis4agent-other', 'id'), false);
});
