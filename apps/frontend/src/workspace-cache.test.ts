import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceCache, validLayout } from './workspace-cache.ts';
import type { WorkspaceView } from './workspace-cache.ts';
const fixture = (): WorkspaceView => ({ project: { id: 'one', name: 'one', root: 'E:/one' },
  analysis: { schemaVersion: 1, revision: 'a'.repeat(64), scannedFiles: 1, graphs: [], diagnostics: [] },
  graphId: 'graph-two', references: true, layouts: { 'graph-two': { revision: 'a'.repeat(64), value: { schemaVersion: 1, revision: 'layout-one', positions: { node: { x: 30, y: 90 } } } } } });
const store = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) || null,
  setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; };
test('iframe recreation restores the same project, selected graph and saved layout synchronously', () => {
  const storage = store(), first = createWorkspaceCache('/api', storage); first.write('E:/one', fixture());
  const second = createWorkspaceCache('/api', storage), recovered = second.read('E:\\one');
  assert.deepEqual(recovered, fixture()); recovered!.project.name = 'changed by caller';
  assert.equal(second.read('E:/one')!.project.name, 'one');
  assert.equal(second.read('E:/another'), null); assert.equal(createWorkspaceCache('/other-api', storage).read('E:/one'), null);
});
test('expired, corrupt or oversized entries fall back to a normal read instead of crashing', () => {
  const storage = store(); createWorkspaceCache('/api', storage, () => 1000).write('E:/one', fixture());
  assert.equal(createWorkspaceCache('/api', storage, () => 1000 + 25 * 3600000).read('E:/one'), null);
  const key = [...storage.values.keys()].find(k => !k.includes('index:'))!;
  storage.setItem(key, '{broken'); assert.equal(createWorkspaceCache('/api', storage).read('E:/one'), null);
  storage.setItem(key, 'x'.repeat(1_500_001)); assert.equal(createWorkspaceCache('/api', storage).read('E:/one'), null);
  assert.equal(validLayout({ schemaVersion: 1, revision: 'x', positions: { n: { x: Infinity, y: 0 } } }), false);
});
test('cache is bounded and storage denial preserves the current page memory fallback', () => {
  const storage = store(), cache = createWorkspaceCache('/api', storage);
  for (let i = 0; i < 4; ++i) cache.write('E:/' + i, fixture());
  assert.equal(createWorkspaceCache('/api', storage).read('E:/0'), null);
  assert.ok(createWorkspaceCache('/api', storage).read('E:/3'));
  const denied = createWorkspaceCache('/api', { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() {} });
  denied.write('E:/one', fixture()); assert.deepEqual(denied.read('E:/one'), fixture());
});
