import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleStorage } from './legacy-storage.ts';
import { readViewMode, saveViewMode } from './view-mode.ts';
import { environmentValue, behaviorMarker, hostTaskMatches, configurationNames } from '../../../scripts/runtime/brand.mjs';
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
  assert.equal(storage.getItem('dsh-langgraph-canvas:view-mode'), 'standard');
});
test('legacy drafts can be explicitly cleared without coming back through fallback', () => {
  const storage = memory(), current = 'dsh-langgraph-canvas:structure-draft:p:g', old = 'vis4agent:structure-draft:p:g';
  storage.setItem(old, '{"requestId":"kept"}');
  const compatible = compatibleStorage(storage)!;
  assert.equal(compatible.getItem(current), '{"requestId":"kept"}');
  compatible.setItem(current, '{"requestId":"new"}');
  compatible.removeItem(current);
  assert.equal(compatible.getItem(current), null); assert.equal(storage.getItem(old), null);
});
test('legacy API namespaces in cache keys are translated without renaming the workspace directory', () => {
  const storage = memory();
  storage.setItem('vis4agent:workspace-view:v1:["/vis4agent/api/v1","E:/projects/dsh-langgraph-canvas"]', 'snapshot');
  assert.equal(compatibleStorage(storage)!.getItem('dsh-langgraph-canvas:workspace-view:v1:["/dsh-langgraph-canvas/api/v1","E:/projects/dsh-langgraph-canvas"]'), 'snapshot');
  storage.setItem('unrelated:setting', 'kept');
  assert.equal(compatibleStorage(storage)!.getItem('unrelated:setting'), 'kept');
});
test('old uncertain analysis receipts are recovered without automatic resubmission and manual recovery reuses the same ID', async t => {
  const storage = memory(), revision = 'a'.repeat(64), posts: string[] = [];
  const oldKey = 'vis4agent:analysis-request:' + JSON.stringify(['/vis4agent/api/v1', 'project', 'session']);
  storage.setItem(oldKey, JSON.stringify({ id: 'old-request-id', revision, runtimeId: 'runtime' }));
  let backendTask: AnalysisTask | null = null;
  const api: Pick<ApiClient, 'base' | 'analysisSnapshot' | 'analysisSupport' | 'startAnalysis' | 'cancelAnalysis'> = {
    base: '/dsh-langgraph-canvas/api/v1',
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
  assert.equal(environmentValue('PYTHON', { DSH_LANGGRAPH_CANVAS_PYTHON: ' new-python ', VIS4AGENT_PYTHON: 'old-python' }), 'new-python');
  assert.equal(resolvePythonCommand(undefined, { env: { VIS4AGENT_PYTHON: 'old-python' }, exists: () => false }), 'old-python');
  assert.equal(resolvePythonCommand('explicit', { env: { DSH_LANGGRAPH_CANVAS_PYTHON: 'new-python' }, exists: () => false }), 'explicit');
});
test('legacy task identifiers and markers remain exact and do not accept unrelated workspaces or task IDs', () => {
  assert.equal(behaviorMarker('dsh-langgraph-canvas-behavior-abc'), '.dsh-langgraph-canvas-owner.json');
  assert.equal(behaviorMarker('vis4agent-behavior-abc'), '.vis4agent-owner.json');
  assert.equal(behaviorMarker('unowned-behavior-abc'), undefined);
  assert.equal(hostTaskMatches('vis4agent-id', 'id'), true);
  assert.equal(hostTaskMatches('dsh-langgraph-canvas-id', 'id'), true);
  assert.equal(hostTaskMatches('vis4agent-other', 'id'), false);
});

test('the immediate previous name wins over the oldest name and clearing removes all generations', () => {
  const storage = memory();
  storage.setItem('vis4agent:structure-draft:p:g', 'oldest');
  storage.setItem('langcontour:structure-draft:p:g', 'previous');
  const current = 'dsh-langgraph-canvas:structure-draft:p:g', compatible = compatibleStorage(storage)!;
  assert.equal(compatible.getItem(current), 'previous');
  compatible.setItem(current, 'current'); assert.equal(compatible.getItem(current), 'current');
  compatible.removeItem(current); assert.equal(compatible.getItem(current), null);
  assert.equal(storage.getItem('langcontour:structure-draft:p:g'), null);
  assert.equal(storage.getItem('vis4agent:structure-draft:p:g'), null);
});

test('previous automatic analysis attempt is honored after namespace change without making a model request', async t => {
  const storage = memory(), revision = 'b'.repeat(64); let posts = 0;
  storage.setItem('langcontour:analysis-auto:' + JSON.stringify(['/langcontour/api/v1', 'project', 'session']), JSON.stringify([revision]));
  const api: Pick<ApiClient, 'base' | 'analysisSnapshot' | 'analysisSupport' | 'startAnalysis' | 'cancelAnalysis'> = {
    base: '/dsh-langgraph-canvas/api/v1',
    async analysisSnapshot() { return { runtimeId: 'new-runtime', task: null, blockedByOtherSession: false }; },
    async analysisSupport() { throw new Error('No readiness request expected'); },
    async startAnalysis() { posts++; throw new Error('Must not replay'); },
    async cancelAnalysis() { throw new Error('Must not cancel'); },
  };
  const monitor = createAnalysisMonitor(api, 'project', 'session', storage); t.after(monitor.connect());
  for (let i = 0; !monitor.getSnapshot().synced && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(monitor.getSnapshot().synced, true);
  await monitor.startAutomatically(revision, false); assert.equal(posts, 0); assert.equal(monitor.wasAutomaticallyAttempted(revision), true);
});

test('configuration and ownership support both predecessors while the canonical environment takes precedence', () => {
  assert.deepEqual(configurationNames, ['__DSH_LANGGRAPH_CANVAS_CONFIG__', '__LANGCONTOUR_CONFIG__', '__VIS4AGENT_CONFIG__']);
  assert.equal(environmentValue('PYTHON', { LANGCONTOUR_PYTHON: 'previous', VIS4AGENT_PYTHON: 'oldest' }), 'previous');
  assert.equal(environmentValue('PYTHON', { DSH_LANGGRAPH_CANVAS_PYTHON: 'current', LANGCONTOUR_PYTHON: 'previous' }), 'current');
  assert.equal(behaviorMarker('langcontour-behavior-owned'), '.langcontour-owner.json');
  assert.equal(hostTaskMatches('langcontour-task', 'task'), true);
  assert.equal(hostTaskMatches('langcontour-other', 'task'), false);
});
