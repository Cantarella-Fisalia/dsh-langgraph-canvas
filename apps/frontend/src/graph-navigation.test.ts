import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphNavigation, MAX_GRAPH_HISTORY } from './graph-navigation.ts';
import type { GraphViewSnapshot } from './graph-navigation.ts';

const ids = ['A', 'B', 'C'];
function snapshot(graphId = 'A'): GraphViewSnapshot {
  return { graphId, sourceRevision: 'source1', layoutRevision: 'layout1', positions: { work: { x: 71, y: 93 } },
    dirty: true, viewport: { x: -145, y: 19, zoom: 0.7 }, selectedNodeId: 'work' };
}
test('returns through the actual caller path, including nested calls', () => {
  const nav = new GraphNavigation('project');
  assert.equal(nav.open('A', 'B', ids), 'B');
  assert.equal(nav.open('B', 'C', ids), 'C');
  assert.equal(nav.previous('C', ids), 'B');
  assert.equal(nav.back('C', ids), 'B');
  assert.equal(nav.back('B', ids), 'A');
  assert.equal(nav.back('A', ids), undefined);
});
test('same graph and unknown targets never add a navigation step', () => {
  const nav = new GraphNavigation('project');
  for (const [from, to] of [['A', 'A'], ['A', 'missing'], ['missing', 'B']]) assert.equal(nav.open(from, to, ids), undefined);
  assert.equal(nav.previous('A', ids), undefined);
});
test('skips removed graphs and bounds repeated navigation history', () => {
  const nav = new GraphNavigation('project');
  nav.open('A', 'B', ids); nav.open('B', 'C', ids);
  assert.equal(nav.previous('C', ['A', 'C']), 'A');
  assert.equal(nav.back('C', ['A', 'C']), 'A');
  let current = 'A';
  for (let i = 0; i < MAX_GRAPH_HISTORY + 20; i++) current = nav.open(current, current === 'A' ? 'B' : 'A', ids)!;
  let count = 0;
  while (true) { const previous = nav.back(current, ids); if (!previous) break; count++; current = previous; }
  assert.equal(count, MAX_GRAPH_HISTORY);
});
test('snapshots preserve dirty positions, selection, viewport and optimistic layout version without aliasing', () => {
  const nav = new GraphNavigation('project'), input = snapshot();
  nav.remember(input); input.positions.work.x = 999;
  const restored = nav.view('A', 'source1')!;
  assert.equal(restored.positions.work.x, 71);
  assert.deepEqual(restored.viewport, { x: -145, y: 19, zoom: 0.7 });
  assert.equal(restored.dirty, true); assert.equal(restored.layoutRevision, 'layout1'); assert.equal(restored.selectedNodeId, 'work');
  restored.viewport.zoom = 9; restored.positions.work.y = 999;
  assert.equal(nav.view('A', 'source1')!.positions.work.y, 93);
  assert.equal(nav.view('A', 'source1')!.viewport.zoom, 0.7);
});
test('new scopes have no old views or paths and stale source revisions are rejected', () => {
  const nav = new GraphNavigation('project1'); nav.remember(snapshot()); nav.open('A', 'B', ids);
  assert.equal(nav.view('A', 'source2'), undefined);
  const next = new GraphNavigation('project2');
  assert.equal(next.view('A', 'source1'), undefined); assert.equal(next.previous('B', ids), undefined);
});
test('manual graph selection starts a new path and retains per-graph views', () => {
  const nav = new GraphNavigation('project'); nav.remember(snapshot()); nav.open('A', 'B', ids);
  assert.equal(nav.choose('B', 'B', ids), undefined);
  assert.equal(nav.choose('B', 'missing', ids), undefined);
  assert.equal(nav.previous('B', ids), 'A');
  assert.equal(nav.choose('B', 'C', ids), 'C');
  assert.equal(nav.previous('C', ids), undefined); assert.ok(nav.view('A', 'source1'));
});
test('hidden dirty views warn on leaving the workspace and saved snapshots clear that warning', () => {
  const nav = new GraphNavigation('project'); nav.remember(snapshot());
  assert.equal(nav.hasUnsaved('A'), false); assert.equal(nav.hasUnsaved('B'), true);
  nav.remember({ ...snapshot(), dirty: false, layoutRevision: 'layout2' });
  assert.equal(nav.hasUnsaved(), false); assert.equal(nav.view('A', 'source1')!.layoutRevision, 'layout2');
});
test('same node IDs in different graphs retain their own positions and selected edge', () => {
  const nav = new GraphNavigation('project'); nav.remember(snapshot());
  nav.remember({ ...snapshot('B'), selectedNodeId: undefined, selectedEdgeId: 'route', positions: { work: { x: 333, y: 444 } } });
  assert.equal(nav.view('A', 'source1')!.selectedNodeId, 'work');
  assert.equal(nav.view('A', 'source1')!.positions.work.x, 71);
  assert.equal(nav.view('B', 'source1')!.selectedEdgeId, 'route');
  assert.equal(nav.view('B', 'source1')!.positions.work.x, 333);
});
