import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraphs, graphReadOnly, graphProvenance } from './analysis-view.ts';
import { explanationFor, nodeExecution, explanationCoverage, nodeDisplayName } from './explanation-view.ts';
import { readViewMode, saveViewMode, viewModeKey } from './view-mode.ts';
test('business view hides reference diagrams and inferred graphs stay read-only', () => {
  const business = { id: 'business', discovery: { method: 'static', category: 'project', completeness: 'static', readOnly: false } } as any;
  const docs = { id: 'docs', discovery: { method: 'static', category: 'reference', completeness: 'static', readOnly: false } } as any;
  const ai = { id: 'ai', discovery: { method: 'ai', category: 'project', completeness: 'inferred', readOnly: true } } as any;
  const result = { graphs: [business, docs, ai] } as any;
  assert.deepEqual(projectGraphs(result).map(g => g.id), ['business', 'ai']);
  assert.equal(projectGraphs(result, true).length, 3);
  assert.equal(graphReadOnly(business), false);
  assert.equal(graphReadOnly(ai), true);
  assert.match(graphProvenance(ai), /AI/);
});

test('Chinese functional names replace identifiers for display and distinguish duplicate names without mutating the graph', () => {
  const graph = { nodes: [{ id: '__start__', kind: 'boundary' }, { id: 'retrieve_a', title: 'retrieve_a', functionRef: 'workers.retrieve_a', kind: 'function' },
    { id: 'retrieve_b', title: 'retrieve_b', functionRef: 'workers.retrieve_b', kind: 'function' }, { id: '__end__', kind: 'boundary' }] } as any;
  const before = JSON.stringify(graph);
  const explanation = { nodes: [{ nodeId: 'retrieve_a', displayName: { text: '检索资料' } }, { nodeId: 'retrieve_b', displayName: { text: '检索资料' } }] } as any;
  assert.equal(nodeDisplayName(graph, 'retrieve_a', explanation), '检索资料 · 1');
  assert.equal(nodeDisplayName(graph, 'retrieve_b', explanation), '检索资料 · 2');
  assert.equal(nodeDisplayName(graph, '__start__', explanation), 'START · 入口');
  assert.equal(nodeDisplayName(graph, '__end__', explanation), 'END · 结束');
  assert.equal(JSON.stringify(graph), before);
});

test('old or stale explanations never invent a Chinese meaning from a function name', () => {
  const graph = { nodes: [{ id: 'classify_intent', title: 'classify_intent', kind: 'function' }] } as any;
  const explanation = { graphId: 'g', nodes: [{ nodeId: 'classify_intent', displayName: { text: '识别用户意图' } }] } as any;
  const analysis = { revision: 'new', architecture: { revision: 'old', graphs: [explanation] } } as any;
  assert.equal(nodeDisplayName(graph, 'classify_intent', explanationFor(analysis, 'g')), '功能步骤 1');
  assert.equal(nodeDisplayName(graph, 'classify_intent', { nodes: [] } as any), '功能步骤 1');
  assert.equal(nodeDisplayName(graph, 'classify_intent', explanation), '识别用户意图');
});

test('standard and professional modes change labels without changing graph identities or explanations', () => {
  const graph = { nodes: [{ id: '__start__', kind: 'boundary' }, { id: 'retrieve', kind: 'function', functionRef: 'workers.retrieve', title: 'retrieve' }] } as any;
  const explanation = { nodes: [{ nodeId: 'retrieve', displayName: { text: '检索资料' } }] } as any;
  const before = JSON.stringify({ graph, explanation });
  assert.equal(nodeDisplayName(graph, 'retrieve', explanation, 'standard'), '检索资料');
  assert.equal(nodeDisplayName(graph, 'retrieve', explanation, 'professional'), 'workers.retrieve');
  assert.equal(nodeDisplayName(graph, '__start__', explanation, 'professional'), 'START · 入口');
  assert.equal(nodeDisplayName(graph, 'retrieve', explanation, 'standard'), '检索资料');
  assert.equal(JSON.stringify({ graph, explanation }), before);
});

test('professional names remain original references and shared implementations use registration IDs only for disambiguation', () => {
  const graph = { nodes: [{ id: 'check_a', kind: 'function', functionRef: 'workers.check', title: '检查甲' },
    { id: 'check_b', kind: 'function', functionRef: 'workers.check', title: '检查乙' }, { id: 'unresolved', kind: 'unknown' }] } as any;
  const explanation = { nodes: [{ nodeId: 'check_a', displayName: { text: 'AI润色的名称' } }] } as any;
  assert.equal(nodeDisplayName(graph, 'check_a', explanation, 'professional'), 'workers.check [check_a]');
  assert.equal(nodeDisplayName(graph, 'check_b', explanation, 'professional'), 'workers.check [check_b]');
  assert.equal(nodeDisplayName(graph, 'unresolved', explanation, 'professional'), 'unresolved');
  assert.equal(nodeDisplayName(graph, 'check_a', undefined, 'professional'), 'workers.check [check_a]');
  assert.equal(nodeDisplayName(graph, 'check_a', explanation, 'standard'), 'AI润色的名称');
});

test('mode preference survives recreation and invalid or unavailable storage defaults safely', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readViewMode(storage), 'standard');
  assert.equal(saveViewMode('professional', storage), true);
  assert.equal(readViewMode({ ...storage }), 'professional');
  values.set(viewModeKey, 'unknown'); assert.equal(readViewMode(storage), 'standard');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readViewMode(blocked), 'standard'); assert.equal(saveViewMode('professional', blocked), false);
});
test('AI explanations attach by version and do not rename function nodes as groups or subgraphs', () => {
  const explanation = { graphId: 'main', stateFields: [{ name: 'question' }], conditions: [{ edgeId: 'e1' }] } as any;
  const analysis = { revision: 'version', architecture: { revision: 'version', graphs: [explanation] } } as any;
  assert.equal(explanationFor(analysis, 'main'), explanation);
  assert.equal(explanationFor({ ...analysis, revision: 'changed' }, 'main'), undefined);
  assert.equal(nodeExecution({ execution: 'function' } as any, { execution: 'subgraph' } as any).label, '函数节点');
  assert.equal(nodeExecution({ execution: 'unknown' } as any, { execution: 'callable' } as any).label, '可调用对象／链');
  assert.deepEqual(explanationCoverage({ state: { reference: 'State', fields: [{ name: 'question', annotation: 'str' }, { name: 'answer', annotation: 'str' }] },
    edges: [{ id: 'e1', kind: 'conditional' }, { id: 'e2', kind: 'conditional' }, { id: 'e3', kind: 'normal' }] }, explanation),
    { fields: 1, totalFields: 2, conditions: 1, totalConditions: 2 });
});
