import type { EditorEdge, EditorGraph, EditorNode } from '../../../packages/contracts/src/editing.ts';
import type { GraphDocument, Layout, ProjectAnalysis } from '../../../packages/contracts/src/index.ts';
import type { ArchitectureExplanation } from '../../../packages/contracts/src/explanation.ts';

export interface Decision {
  id: string; from: string; route?: string; edges: EditorEdge[];
}
export interface ChartNode { id: string; item?: EditorNode; decision?: Decision }
export interface ChartEdge { id: string; from: string; to: string; item?: EditorEdge; decision?: Decision }
export interface Flowchart { nodes: ChartNode[]; edges: ChartEdge[]; decisions: Decision[] }

export function edgeLabel(edge: EditorEdge, graph?: EditorGraph | null) {
  if (edge.kind === 'conditional') return '条件 · ' + (edge.label === '' ? '""' : edge.label ?? '未识别条件');
  if (edge.kind === 'join') return '等待汇合';
  if (new Set(graph?.edges.filter(item => item.kind === 'normal' && item.from === edge.from).map(item => item.to)).size > 1) return '并行分发';
  return '直接流转';
}

/** Presentation only: original branch IDs and editor objects remain the source of truth. */
export function buildFlowchart(graph: Pick<EditorGraph, 'nodes' | 'edges'>): Flowchart {
  const ids = new Set(graph.nodes.map(n => n.id));
  const reserved = new Set([...ids, ...graph.edges.map(e => e.id)]);
  const allocate = (base: string) => {
    let id = base;
    for (let i = 1; reserved.has(id); i++) id = `${base}:${i}`;
    reserved.add(id); return id;
  };
  const groups = new Map<string, Decision>();
  const decisionByEdge = new Map<string, Decision>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'conditional' || !ids.has(edge.from) || !ids.has(edge.to)) continue;
    // Separate distinct add_conditional_edges calls, even if they reuse a router.
    const key = JSON.stringify([edge.from, edge.route ?? '', edge.source?.file, edge.source?.line, edge.source?.endLine, edge.source?.column]);
    let decision = groups.get(key);
    if (!decision) {
      decision = { id: allocate(`__langcontour_decision__${encodeURIComponent(edge.id)}`), from: edge.from, route: edge.route, edges: [] };
      groups.set(key, decision);
    }
    decision.edges.push(edge); decisionByEdge.set(edge.id, decision);
  }
  const decisions = [...groups.values()];
  return {
    nodes: [...graph.nodes.map(item => ({ id: item.id, item })), ...decisions.map(decision => ({ id: decision.id, decision }))],
    edges: [
      ...decisions.map(decision => ({ id: allocate(`${decision.id}:input`), from: decision.from, to: decision.id, decision })),
      ...graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(item => ({
        id: item.id, from: decisionByEdge.get(item.id)?.id ?? item.from, to: item.to, item,
      })),
    ], decisions,
  };
}

/** Longest forward paths keep joins below every parent; DFS back edges stay visible as loops. */
export function flowchartPositions(chart: Flowchart, sizes: Record<string, { width: number; height: number }> = {}): Layout['positions'] {
  const order = new Map(chart.nodes.map((n, i) => [n.id, i]));
  const outgoing = new Map(chart.nodes.map(n => [n.id, chart.edges.filter(e => e.from === n.id)]));
  const visiting = new Set<string>(), done = new Set<string>(), forward = new Set<string>();
  const visit = (id: string) => {
    visiting.add(id);
    for (const edge of outgoing.get(id) || []) {
      if (visiting.has(edge.to)) continue;
      forward.add(edge.id);
      if (!done.has(edge.to)) visit(edge.to);
    }
    visiting.delete(id); done.add(id);
  };
  if (order.has('__start__')) visit('__start__');
  for (const node of chart.nodes) if (!done.has(node.id)) visit(node.id);
  const edges = chart.edges.filter(e => forward.has(e.id));
  const indegree = new Map(chart.nodes.map(n => [n.id, edges.filter(e => e.to === n.id).length]));
  const depth = new Map(chart.nodes.map(n => [n.id, 0]));
  const queue = chart.nodes.filter(n => !indegree.get(n.id)).map(n => n.id);
  for (let i = 0; i < queue.length; i++) for (const edge of edges.filter(e => e.from === queue[i])) {
    depth.set(edge.to, Math.max(depth.get(edge.to)!, depth.get(edge.from)! + 1));
    indegree.set(edge.to, indegree.get(edge.to)! - 1);
    if (!indegree.get(edge.to)) queue.push(edge.to);
  }
  const rows = new Map<number, ChartNode[]>();
  for (const node of chart.nodes) {
    const rank = depth.get(node.id)!;
    rows.set(rank, [...(rows.get(rank) || []), node]);
  }
  const positions: Layout['positions'] = {};
  const centers = new Map<string, number>();
  const width = (node: ChartNode) => sizes[node.id]?.width ?? (node.decision ? 184 : node.item?.kind === 'boundary' ? 200 : 240);
  const widest = Math.max(240, ...[...rows.values()].map(nodes => nodes.reduce((sum, n) => sum + width(n), 0) + (nodes.length - 1) * 90));
  let y = 105;
  for (const rank of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(rank)!;
    const parentCenter = (id: string) => {
      const values = edges.filter(e => e.to === id).map(e => centers.get(e.from)).filter((v): v is number => v !== undefined);
      return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : widest / 2;
    };
    row.sort((a, b) => parentCenter(a.id) - parentCenter(b.id) || order.get(a.id)! - order.get(b.id)!);
    const total = row.reduce((sum, n) => sum + width(n), 0) + (row.length - 1) * 90;
    let x = 55 + (widest - total) / 2;
    for (const node of row) {
      positions[node.id] = { x, y };
      centers.set(node.id, x + width(node) / 2); x += width(node) + 90;
    }
    y += Math.max(280, ...row.map(node => (sizes[node.id]?.height ?? 180) + 90));
  }
  return positions;
}

/** Saved layout files contain only real source nodes. Diamonds follow their source on older layouts. */
export function decisionPosition(decision: Decision, positions: Layout['positions'], defaults: Layout['positions']) {
  const from = positions[decision.from];
  if (!from) return defaults[decision.id];
  const forward = decision.edges.map(e => positions[e.to]).filter(p => p && p.y > from.y + 180);
  const nextY = forward.length ? Math.min(...forward.map(p => p.y)) : undefined;
  const offset = defaults[decision.id].y - defaults[decision.from].y;
  return { x: from.x + defaults[decision.id].x - defaults[decision.from].x,
    y: nextY === undefined ? from.y + Math.max(230, offset) : Math.max(from.y + 215, (from.y + nextY) / 2) };
}

export type GraphCall = { target: GraphDocument; relationship: ArchitectureExplanation['relationships'][number] };
export function graphCalls(analysis: ProjectAnalysis | null, graph: Pick<EditorGraph, 'id' | 'nodes'>, visible: GraphDocument[]): Map<string, GraphCall[]> {
  const calls = new Map<string, GraphCall[]>();
  if (!analysis?.architecture || analysis.architecture.revision !== analysis.revision) return calls;
  for (const relationship of analysis.architecture.relationships) {
    if (relationship.fromGraphId !== graph.id || !relationship.viaNodeId || !['registered_subgraph', 'indirect_call'].includes(relationship.kind)) continue;
    const node = graph.nodes.find(n => n.id === relationship.viaNodeId);
    const target = visible.find(g => g.id === relationship.toGraphId && g.id !== graph.id);
    if (!node || !target || node.pending || node.kind === 'boundary' || (relationship.kind === 'registered_subgraph' && node.execution === 'function')) continue;
    const existing = calls.get(node.id) || [];
    if (!existing.some(call => call.target.id === target.id && call.relationship.kind === relationship.kind)) existing.push({ target, relationship });
    calls.set(node.id, existing);
  }
  return calls;
}
