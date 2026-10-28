import test from 'node:test';
import assert from 'node:assert/strict';
import type { GraphDocument } from './index.ts';
import { canonicalJson, draftChanges, editableGraph, identifier, previewGraph, removeDraftEdge, removeDraftNode, validateEditableGraph } from './editing.ts';

const source = { file: 'graph.py', line: 1, endLine: 1, column: 0 };
const base: GraphDocument = {
  schemaVersion: 1, id: 'graph.py::g', title: 'g', file: 'graph.py', symbol: 'g', scope: '', revision: 'source-v1',
  state: { reference: 'State', fields: [{ name: 'question', annotation: 'str' }] },
  nodes: [{ id: '__start__', title: 'START', kind: 'boundary' }, { id: '__end__', title: 'END', kind: 'boundary' },
    { id: 'a', title: 'a', kind: 'function', functionRef: 'work', implementation: source }],
  edges: [{ id: 's', from: '__start__', to: 'a', kind: 'normal', source }, { id: 'e', from: 'a', to: '__end__', kind: 'normal', source }],
  diagnostics: [], capabilities: { structuralEdit: false, sourceRead: true },
};
test('local drafts can be incomplete while confirmed intents reject disconnected or malformed structure', () => {
  const target = editableGraph(base);
  target.nodes.push({ id: 'review', functionRef: 'review', description: '检查回答' });
  assert.deepEqual(validateEditableGraph(target, base, false), []);
  assert.ok(validateEditableGraph(target, base).some(e => e.includes('START 可达')));
  target.edges.push({ id: 'to-review', from: 'a', to: 'review', kind: 'normal' });
  assert.deepEqual(validateEditableGraph(target, base), []);
  target.nodes.push({ ...target.nodes[2] });
  assert.ok(validateEditableGraph(target, base).some(e => e.includes('重复')));
  assert.ok(validateEditableGraph({ ...target, edges: null }, base).length);
  assert.ok(validateEditableGraph({ ...target, state: { reference: 'Other', fields: [] } }, base).length);
});
test('boundary rules, conditional labels and wait groups are checked without executing annotation text', () => {
  assert.equal(identifier('match'), true);
  assert.equal(identifier('class'), false);
  const target = editableGraph(base);
  target.state.fields.push({ name: 'history', annotation: 'Annotated[list[str], operator.add]' });
  target.edges.push({ id: 'c1', from: 'a', to: '__end__', kind: 'conditional', route: 'route', label: 'done' },
    { id: 'c2', from: 'a', to: 'a', kind: 'conditional', route: 'route', label: 'done' });
  assert.ok(validateEditableGraph(target, base).some(e => e.includes('分支值重复')));
  target.edges.pop();
  assert.deepEqual(validateEditableGraph(target, base), []);
  target.edges.push({ id: 'bad', from: '__end__', to: '__start__', kind: 'normal' });
  assert.ok(validateEditableGraph(target, base).some(e => e.includes('END 不能')));
  assert.throws(() => removeDraftNode(target, '__start__'));
});
test('join deletion is atomic and node removal never leaves a partial wait group', () => {
  const target = editableGraph(base);
  target.nodes.push({ id: 'b', functionRef: 'b', description: '' }, { id: 'finish', functionRef: 'finish', description: '' });
  target.edges.push({ id: 'ab', from: 'a', to: 'b', kind: 'normal' },
    { id: 'j1', from: 'a', to: 'finish', kind: 'join', joinId: 'wait' }, { id: 'j2', from: 'b', to: 'finish', kind: 'join', joinId: 'wait' });
  assert.deepEqual(validateEditableGraph(target, base), []);
  assert.equal(removeDraftEdge(target, target.edges.at(-1)!).edges.some(e => e.joinId === 'wait'), false);
  assert.equal(removeDraftNode(target, 'b').edges.some(e => e.joinId === 'wait'), false);
  assert.throws(() => removeDraftEdge(target, { id: 'bad', from: 'a', to: 'finish', kind: 'join' }));
  const broken = { ...target, edges: target.edges.filter(e => e.id !== 'j2') };
  assert.ok(validateEditableGraph(broken, base).some(e => e.includes('至少两个')));
});
test('diff ignores object key order, new previews have no fabricated source, and empty builders expose fixed boundaries', () => {
  const original = editableGraph(base);
  const reordered = JSON.parse(JSON.stringify(original));
  reordered.nodes = reordered.nodes.map((n: any) => ({ description: n.description, functionRef: n.functionRef, id: n.id }));
  assert.deepEqual(draftChanges(original, reordered), []);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  const target = structuredClone(original);
  target.nodes.push({ id: 'new', functionRef: 'new_step', description: '新步骤' });
  target.edges.push({ id: 'new-edge', from: 'a', to: 'new', kind: 'normal' });
  const preview = previewGraph(base, target);
  assert.equal(preview.nodes.at(-1)?.pending, true);
  assert.equal(preview.nodes.at(-1)?.implementation, undefined);
  assert.equal(preview.edges.at(-1)?.source, undefined);
  assert.equal(draftChanges(original, target).length, 2);
  const empty = { ...base, nodes: [], edges: [] };
  assert.deepEqual(editableGraph(empty).nodes.map(n => n.id), ['__start__', '__end__']);
  assert.equal(previewGraph(empty, editableGraph(empty)).nodes[0].kind, 'boundary');
});
