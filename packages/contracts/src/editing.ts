import type { GraphDocument, GraphEdge, GraphNode, Project, SourceLocation } from './index.ts';

export interface EditableNode { id: string; functionRef?: string; description: string }
export interface EditableEdge {
  id: string; from: string; to: string; kind: 'normal' | 'conditional' | 'join';
  label?: string; route?: string; joinId?: string;
}
export interface EditableGraph {
  state: GraphDocument['state']; nodes: EditableNode[]; edges: EditableEdge[];
}
export interface DraftChange { kind: string; label: string; detail: string }
export interface StructureDraft {
  schemaVersion: 1; projectId: string; graphId: string; baseRevision: string;
  requestId: string; target: EditableGraph; receipt?: EditReceipt;
  original: EditableGraph;
}
export interface ConfirmEditRequest {
  schemaVersion: 1; requestId: string; graphId: string; baseRevision: string; confirmed: true; target: EditableGraph;
}
export interface EditSupport { available: boolean; message: string; mode: 'request-only' }
export interface EditReceipt { requestId: string; taskId: string; status: 'accepted'; message: string }
export interface ConfirmedEditIntent {
  schemaVersion: 1; requestId: string; project: Project; graphId: string; baseRevision: string;
  original: EditableGraph; target: EditableGraph; changes: DraftChange[]; confirmedAt: string;
  sourceWriteAllowed: false;
}
/** A confirmed intent receiver, not a source-writing executor. Later stages own code transactions. */
export interface EditRequestAdapter {
  submit(intent: ConfirmedEditIntent): Promise<{ taskId: string }>;
}
export type EditorNode = GraphNode & { pending?: boolean };
export type EditorEdge = Omit<GraphEdge, 'source'> & { source?: SourceLocation; pending?: boolean };
export type EditorGraph = Omit<GraphDocument, 'nodes' | 'edges'> & { nodes: EditorNode[]; edges: EditorEdge[] };

const boundary = (id: string) => id === '__start__' || id === '__end__';
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const keywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
export const identifier = (value: string) => /^[\p{ID_Start}_][\p{ID_Continue}_]*$/u.test(value) && !keywords.has(value);
export const functionReference = (value: string) => value.split('.').every(identifier);
export const newNodeName = (value: string) => /^[\p{L}\p{N}_-]+$/u.test(value) && !boundary(value);

export function editableGraph(graph: GraphDocument): EditableGraph {
  return {
    state: structuredClone(graph.state),
    nodes: [...graph.nodes.map(n => ({ id: n.id, functionRef: n.functionRef, description: n.summary || '' })),
      ...['__start__', '__end__'].filter(id => !graph.nodes.some(n => n.id === id)).map(id => ({ id, description: '' }))],
    edges: graph.edges.map(e => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label, route: e.route, joinId: e.joinId })),
  };
}
function text(value: unknown, limit: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= limit && (empty || !!value.trim()) && !value.includes('\0');
}
/** Validates untrusted JSON without evaluating function references or Python annotations. */
export function validateEditableGraph(value: unknown, base: GraphDocument, strict = true): string[] {
  const graph = value as EditableGraph;
  const errors: string[] = [];
  if (!graph || typeof graph !== 'object' || !graph.state || graph.state.reference !== base.state.reference ||
      !Array.isArray(graph.state.fields) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      graph.nodes.length > 500 || graph.edges.length > 2000 || graph.state.fields.length > 256) {
    return ['结构草稿格式无效，不能更换原图的 State 引用，或超出本批数量限制。'];
  }
  const originalNodes = new Map(editableGraph(base).nodes.map(n => [n.id, n]));
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node || !text(node.id, 128) || !text(node.description, 4000, true) ||
        (node.functionRef !== undefined && !text(node.functionRef, 512, true))) {
      errors.push('节点需要有效名称、职责文本和函数引用。'); continue;
    }
    if (nodeIds.has(node.id)) errors.push('节点名称重复：' + node.id);
    nodeIds.add(node.id);
    const original = originalNodes.get(node.id);
    if (!original && !newNodeName(node.id)) errors.push('新节点名称仅支持文字、数字、下划线和短横线，不能使用 START/END 保留名称。');
    if (node.functionRef && node.functionRef !== original?.functionRef && !functionReference(node.functionRef)) errors.push('函数引用应为 Python 标识符或点分引用：' + node.id);
    if (!boundary(node.id) && !original && !node.functionRef) errors.push('新节点需要实现函数名称：' + node.id);
    if (boundary(node.id) && original && (node.functionRef || node.description !== original.description)) errors.push('START/END 流程边界不可修改。');
  }
  for (const node of originalNodes.values()) {
    if (!boundary(node.id)) continue;
    if (!nodeIds.has(node.id)) errors.push('不能删除流程边界：' + node.id);
  }
  const fields = new Set<string>();
  for (const field of graph.state.fields) {
    if (!field || !text(field.name, 128) || !identifier(field.name) || !text(field.annotation, 1000)) {
      errors.push('State 字段需要有效 Python 名称与类型注解。'); continue;
    }
    if (fields.has(field.name)) errors.push('State 字段重复：' + field.name);
    fields.add(field.name);
  }
  const ids = new Set<string>();
  const signatures = new Set<string>();
  const conditionKeys = new Set<string>();
  const groups = new Map<string, EditableEdge[]>();
  for (const edge of graph.edges) {
    if (!edge || !text(edge.id, 512) || !text(edge.from, 128) || !text(edge.to, 128) ||
        !['normal', 'conditional', 'join'].includes(edge.kind)) { errors.push('连线格式无效。'); continue; }
    if (ids.has(edge.id)) errors.push('连线 ID 重复。');
    ids.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) errors.push('连线引用了不存在的节点：' + edge.from + ' → ' + edge.to);
    if (edge.from === '__end__' || edge.to === '__start__') errors.push('END 不能有出边，START 不能有入边。');
    if (edge.kind === 'conditional') {
      if (!text(edge.label, 512, true) || !text(edge.route, 512) || !functionReference(edge.route!)) errors.push('条件边需要分支值与路由函数。');
      const key = JSON.stringify([edge.from, edge.route, edge.label]);
      if (conditionKeys.has(key)) errors.push('同一路由的分支值重复：' + edge.label);
      conditionKeys.add(key);
      if (edge.joinId !== undefined) errors.push('条件边不能带汇合组。');
    } else if (edge.label !== undefined || edge.route !== undefined) errors.push('普通／汇合边不能包含条件路由。');
    if (edge.kind === 'join') {
      if (!text(edge.joinId, 512)) errors.push('汇合边缺少分组。');
      else groups.set(edge.joinId, [...(groups.get(edge.joinId) || []), edge]);
    } else if (edge.joinId !== undefined) errors.push('只有汇合边允许汇合组。');
    const signature = JSON.stringify([edge.from, edge.to, edge.kind, edge.label, edge.route, edge.joinId]);
    if (signatures.has(signature)) errors.push('存在重复连线：' + edge.from + ' → ' + edge.to);
    signatures.add(signature);
  }
  for (const edges of groups.values()) {
    if (edges.length < 2 || new Set(edges.map(e => e.from)).size !== edges.length || new Set(edges.map(e => e.to)).size !== 1) {
      errors.push('等待汇合需要至少两个不同来源，并指向同一目标；请按整组修改。');
    }
  }
  if (strict && !errors.length) {
    const reached = new Set(['__start__']);
    for (let index = 0; index < graph.nodes.length; index++) {
      let changed = false;
      for (const edge of graph.edges) if (reached.has(edge.from) && !reached.has(edge.to)) { reached.add(edge.to); changed = true; }
      if (!changed) break;
    }
    for (const node of graph.nodes) if (!boundary(node.id) && !reached.has(node.id)) errors.push('节点尚未连接到 START 可达路径：' + node.id);
    if (!graph.nodes.some(n => !boundary(n.id))) errors.push('至少需要一个业务节点。');
  }
  return [...new Set(errors)];
}
export function draftChanges(original: EditableGraph, target: EditableGraph): DraftChange[] {
  const changes: DraftChange[] = [];
  function compare<T>(before: T[], after: T[], key: (item: T) => string, kind: string, detail: (item: T) => string) {
    const display = (item: T, id: string) => kind === 'edge' ? (item as EditableEdge).from + ' → ' + (item as EditableEdge).to : id;
    const a = new Map(before.map(item => [key(item), item]));
    const b = new Map(after.map(item => [key(item), item]));
    for (const [id, item] of a) {
      if (!b.has(id)) changes.push({ kind: kind + '.remove', label: '删除' + kindName(kind) + ' ' + display(item, id), detail: detail(item) });
      else if (!same(item, b.get(id))) changes.push({ kind: kind + '.update', label: '修改' + kindName(kind) + ' ' + display(item, id), detail: detail(item) + ' → ' + detail(b.get(id)!) });
    }
    for (const [id, item] of b) if (!a.has(id)) changes.push({ kind: kind + '.add', label: '新增' + kindName(kind) + ' ' + display(item, id), detail: detail(item) });
  }
  compare(original.nodes, target.nodes, n => n.id, 'node', n => [n.functionRef || '无函数', n.description].filter(Boolean).join(' · '));
  compare(original.edges, target.edges, e => e.id, 'edge', e => e.from + ' → ' + e.to + ' · ' + (e.kind === 'conditional' ? '条件 ' + e.label + ' / ' + e.route : e.kind === 'join' ? '等待全部前置完成' : '普通流转'));
  compare(original.state.fields, target.state.fields, f => f.name, 'field', f => f.annotation);
  return changes;
}
function kindName(kind: string) { return ({ node: '节点', edge: '连线', field: 'State 字段' } as Record<string, string>)[kind]; }
export function previewGraph(base: GraphDocument, target: EditableGraph): EditorGraph {
  const original = editableGraph(base);
  return { ...base, state: target.state,
    nodes: target.nodes.map(node => {
      const previous = base.nodes.find(n => n.id === node.id);
      return { ...previous, id: node.id, title: node.id, kind: boundary(node.id) ? 'boundary' : previous?.kind || 'unknown',
        functionRef: node.functionRef, summary: node.description, pending: !same(original.nodes.find(n => n.id === node.id), node) };
    }),
    edges: target.edges.map(edge => ({ ...base.edges.find(e => e.id === edge.id), ...edge,
      pending: !same(original.edges.find(e => e.id === edge.id), edge) })),
  };
}
export function removeDraftNode(graph: EditableGraph, id: string): EditableGraph {
  if (boundary(id)) throw new Error('不能删除 START/END。');
  const groups = new Set(graph.edges.filter(e => e.kind === 'join' && (e.from === id || e.to === id)).map(e => e.joinId));
  return { ...graph, nodes: graph.nodes.filter(n => n.id !== id),
    edges: graph.edges.filter(e => e.from !== id && e.to !== id && !(e.kind === 'join' && groups.has(e.joinId))) };
}
export function removeDraftEdge(graph: EditableGraph, edge: EditableEdge): EditableGraph {
  if (edge.kind === 'join' && !edge.joinId) throw new Error('汇合组未识别，不能按单条连线移除。');
  return { ...graph, edges: graph.edges.filter(e => edge.kind === 'join' ? e.joinId !== edge.joinId : e.id !== edge.id) };
}
export function normalizeEditableGraph(graph: EditableGraph): EditableGraph {
  return {
    state: { reference: graph.state.reference, fields: graph.state.fields.map(f => ({ name: f.name, annotation: f.annotation })) },
    nodes: graph.nodes.map(n => ({ id: n.id, functionRef: n.functionRef || undefined, description: n.description })),
    edges: graph.edges.map(e => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label, route: e.route, joinId: e.joinId })),
  };
}
