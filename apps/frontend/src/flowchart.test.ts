import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowchart, flowchartPositions, decisionPosition, graphCalls } from './flowchart.ts';
import type { EditorGraph, EditorEdge } from '../../../packages/contracts/src/editing.ts';
import type { ProjectAnalysis, GraphDocument } from '../../../packages/contracts/src/index.ts';

function graph(ids: string[], edges: Partial<EditorEdge>[]): EditorGraph {
  return { id: 'main', nodes: ids.map(id => ({ id, kind: id.startsWith('__') ? 'boundary' : 'function', title: id, execution: 'function' })),
    edges: edges.map((e, i) => ({ id: `edge-${i}`, kind: 'normal', ...e })) } as EditorGraph;
}
const location = (line: number) => ({ file: 'graph.py', line, endLine: line, column: 0 });

test('diamonds preserve original branch objects and IDs, including START routing, without changing the source graph', () => {
  const input = graph(['__start__', 'a', 'b', '__end__'], [
    { from: '__start__', to: 'a', kind: 'conditional', route: 'entry', label: 'a', source: location(12) },
    { from: '__start__', to: 'b', kind: 'conditional', route: 'entry', label: 'b', source: location(12) },
    { from: 'a', to: '__end__' }, { from: 'b', to: '__end__' },
  ]);
  const before = JSON.stringify(input), chart = buildFlowchart(input);
  assert.equal(chart.decisions.length, 1); assert.equal(chart.nodes.length, input.nodes.length + 1);
  const decision = chart.decisions[0];
  assert.equal(decision.from, '__start__');
  assert.equal(chart.edges.find(e => e.id === 'edge-0')?.from, decision.id);
  assert.equal(chart.edges.find(e => e.id === 'edge-0')?.item, input.edges[0]);
  assert.equal(chart.edges.find(e => e.decision)?.from, '__start__');
  assert.equal(JSON.stringify(input), before);
});

test('separate router registrations do not collapse and parallel/join edges do not acquire decisions', () => {
  const input = graph(['a', 'b', 'c'], [
    { from: 'a', to: 'b', kind: 'conditional', route: 'route', source: location(10) },
    { from: 'a', to: 'c', kind: 'conditional', route: 'route', source: location(20) },
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c', kind: 'join', joinId: 'wait' },
  ]);
  const chart = buildFlowchart(input);
  assert.equal(chart.decisions.length, 2);
  for (const id of ['edge-2', 'edge-3', 'edge-4']) assert.equal(chart.edges.find(e => e.id === id)?.from, input.edges.find(e => e.id === id)?.from);
  const positions = flowchartPositions(chart);
  assert.notEqual(decisionPosition(chart.decisions[0], positions, positions).x, decisionPosition(chart.decisions[1], positions, positions).x);
});

test('synthetic IDs never collide with source nodes or edges and malformed endpoints are not rendered', () => {
  const input = graph(['a', 'b', '__vis4agent_decision__edge-0'], [{ from: 'a', to: 'b', kind: 'conditional' }, { from: 'missing', to: 'a' }]);
  const chart = buildFlowchart(input);
  assert.notEqual(chart.decisions[0].id, '__vis4agent_decision__edge-0');
  assert.equal(new Set(chart.nodes.map(n => n.id)).size, chart.nodes.length);
  assert.equal(chart.edges.some(e => e.item?.from === 'missing'), false);
});

test('joins appear after the longest prerequisite path rather than sharing a row with an unfinished branch', () => {
  const chart = buildFlowchart(graph(['__start__', 'a', 'b', 'c', 'finish', '__end__'], [
    { from: '__start__', to: 'a' }, { from: '__start__', to: 'b' }, { from: 'b', to: 'c' },
    { from: 'a', to: 'finish', kind: 'join' }, { from: 'c', to: 'finish', kind: 'join' }, { from: 'finish', to: '__end__' },
  ]));
  const p = flowchartPositions(chart);
  assert.ok(p.finish.y > p.c.y); assert.ok(p.finish.y > p.a.y); assert.ok(p.__end__.y > p.finish.y);
  assert.notEqual(p.a.x, p.b.x); assert.equal(p.a.y, p.b.y);
  assert.deepEqual(flowchartPositions(chart), p);
});

test('retry loops, self loops and disconnected nodes retain finite deterministic positions', () => {
  const chart = buildFlowchart(graph(['__start__', 'select', 'validate', '__end__', 'isolated'], [
    { from: '__start__', to: 'select' }, { from: 'select', to: 'validate' },
    { from: 'validate', to: 'select', kind: 'conditional', route: 'retry', label: 'retry' },
    { from: 'validate', to: '__end__', kind: 'conditional', route: 'retry', label: 'done' },
    { from: 'isolated', to: 'isolated' },
  ]));
  const p = flowchartPositions(chart);
  assert.equal(Object.keys(p).length, chart.nodes.length);
  for (const position of Object.values(p)) assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
  assert.ok(p.validate.y > p.select.y); assert.ok(p.__end__.y > p.validate.y);
  assert.ok(chart.edges.some(e => e.item?.label === 'retry' && e.to === 'select'));
});

test('diamonds follow dragged nodes without adding virtual entries to source layout positions', () => {
  const input = graph(['a', 'b'], [{ from: 'a', to: 'b', kind: 'conditional' }]);
  const chart = buildFlowchart(input), defaults = flowchartPositions(chart);
  const saved = { a: { x: 800, y: 200 }, b: { x: 800, y: 900 } }, before = JSON.stringify(saved);
  const p = decisionPosition(chart.decisions[0], saved, defaults);
  assert.ok(p.y > saved.a.y && p.y < saved.b.y);
  assert.equal(p.x, saved.a.x + defaults[chart.decisions[0].id].x - defaults.a.x);
  assert.equal(JSON.stringify(saved), before); assert.equal(Object.keys(saved).length, input.nodes.length);
});

test('graph calls require current evidence-backed relationships, respect visibility, and retain function execution identity', () => {
  const main = graph(['a', 'b'], []), child = { id: 'child', title: 'child' } as GraphDocument;
  const relations = ['indirect_call', 'shared_state', 'possible', 'registered_subgraph'].map(kind => ({
    fromGraphId: 'main', toGraphId: 'child', viaNodeId: 'a', kind,
  }));
  const analysis = { revision: 'v1', architecture: { revision: 'v1', relationships: relations } } as ProjectAnalysis;
  const calls = graphCalls(analysis, main, [child]);
  assert.equal(calls.get('a')?.length, 1); assert.equal(calls.get('a')?.[0].relationship.kind, 'indirect_call');
  assert.equal(main.nodes[0].execution, 'function');
  assert.equal(graphCalls({ ...analysis, revision: 'v2' }, main, [child]).size, 0);
  assert.equal(graphCalls(analysis, main, []).size, 0);
  assert.equal(graphCalls(null, main, [child]).size, 0);
  main.nodes[0].pending = true;
  assert.equal(graphCalls(analysis, main, [child]).size, 0);
});

test('direct subgraphs retain their own shape and duplicate relationships do not duplicate navigation', () => {
  const main = graph(['sub'], []); main.nodes[0].execution = 'subgraph';
  const child = { id: 'child' } as GraphDocument;
  const relation = { fromGraphId: 'main', toGraphId: 'child', viaNodeId: 'sub', kind: 'registered_subgraph' };
  const analysis = { revision: 'v', architecture: { revision: 'v', relationships: [relation, relation] } } as ProjectAnalysis;
  assert.equal(graphCalls(analysis, main, [child]).get('sub')?.length, 1);
});
