import type { ProjectAnalysis, GraphDocument, GraphNode } from '../../../packages/contracts/src/index.ts';
import type { GraphExplanation, NodeExplanation } from '../../../packages/contracts/src/explanation.ts';
import type { ViewMode } from './view-mode.ts';

export const fieldRoles = { input: '输入', intermediate: '中间数据', output: '输出', mixed: '兼有多种用途', unknown: '用途待确认' };
export const relationNames = { registered_subgraph: '直接注册子图', indirect_call: '函数内部调用', shared_state: '共用状态定义', possible: '可能有关联 · 待确认' };
export function explanationFor(analysis: ProjectAnalysis | null, graphId?: string): GraphExplanation | undefined {
  return analysis?.architecture?.revision === analysis?.revision ? analysis?.architecture?.graphs.find(g => g.graphId === graphId) : undefined;
}
export function nodeExecution(node: GraphNode, explanation?: NodeExplanation) {
  const execution = node.execution === 'function' ? 'function' : node.execution && node.execution !== 'unknown' ? node.execution : explanation?.execution || 'unknown';
  return { execution, label: ({ function: '函数节点', callable: '可调用对象／链', subgraph: '子图节点', unknown: '实现类型待确认' } as const)[execution] };
}

export function nodeDisplayName(graph: { nodes: GraphNode[] }, id: string, explanation?: GraphExplanation, mode: ViewMode = 'standard'): string {
  if (id === '__start__') return 'START · 入口';
  if (id === '__end__') return 'END · 结束';
  const nodes = graph.nodes.filter(node => node.kind !== 'boundary');
  if (mode === 'professional') {
    const node = nodes.find(item => item.id === id);
    const reference = node?.functionRef?.trim();
    if (!reference) return id;
    return nodes.filter(item => item.functionRef?.trim() === reference).length > 1 ? `${reference} [${id}]` : reference;
  }
  const base = (node: GraphNode) => {
    const value = explanation?.nodes.find(item => item.nodeId === node.id)?.displayName?.text?.trim();
    if (value && value.length <= 24 && /[\u3400-\u9fff]/u.test(value)) return value;
    if (node.title && /[\u3400-\u9fff]/u.test(node.title) && node.title.length <= 24) return node.title;
    return `功能步骤 ${nodes.findIndex(item => item.id === node.id) + 1}`;
  };
  const node = nodes.find(item => item.id === id);
  if (!node) return '未识别步骤';
  const name = base(node), same = nodes.filter(item => base(item) === name);
  return same.length > 1 ? `${name} · ${same.findIndex(item => item.id === id) + 1}` : name;
}
export function explanationCoverage(graph: { state: GraphDocument['state']; edges: { id: string; kind: string }[] }, explanation?: GraphExplanation) {
  return { fields: graph.state.fields.filter(f => explanation?.stateFields.some(e => e.name === f.name)).length,
    totalFields: graph.state.fields.length, conditions: graph.edges.filter(e => e.kind === 'conditional' && explanation?.conditions.some(c => c.edgeId === e.id)).length,
    totalConditions: graph.edges.filter(e => e.kind === 'conditional').length };
}
