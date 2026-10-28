import type { ProjectAnalysis } from './index.ts';

/** Validate the cross-language boundary before data reaches the UI. */
export function validateAnalysis(input: unknown): ProjectAnalysis {
  const fail = () => { throw new Error('Python 图数据不符合协议 v1。'); };
  if (!input || typeof input !== 'object') return fail();
  const value = input as any;
  if (value.schemaVersion !== 1 || typeof value.revision !== 'string' ||
      !Array.isArray(value.graphs) || !Array.isArray(value.diagnostics) ||
      !Number.isInteger(value.scannedFiles) || value.scannedFiles < 0) return fail();
  function source(source: any) {
    if (source && (typeof source.file !== 'string' || !Number.isInteger(source.line) ||
        source.line < 1 || !Number.isInteger(source.endLine) || source.endLine < source.line)) fail();
  }
  function diagnostics(items: any[]) {
    for (const item of items) {
      if (!item || typeof item.code !== 'string' || typeof item.message !== 'string' ||
          !['info', 'warning', 'error'].includes(item.severity)) fail();
      source(item.source);
    }
  }
  const ids = new Set<string>();
  diagnostics(value.diagnostics);
  for (const graph of value.graphs) {
    if (!graph || graph.schemaVersion !== 1 || typeof graph.id !== 'string' || ids.has(graph.id) ||
        typeof graph.file !== 'string' || typeof graph.revision !== 'string' ||
        typeof graph.title !== 'string' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
        !Array.isArray(graph.diagnostics) || !Array.isArray(graph.state?.fields) ||
        graph.capabilities?.structuralEdit !== false) fail();
    ids.add(graph.id);
    source(graph.state.source);
    for (const field of graph.state.fields) {
      if (!field || typeof field.name !== 'string' || typeof field.annotation !== 'string') fail();
      source(field.source);
    }
    if (graph.discovery) {
      const d = graph.discovery;
      if (!['static', 'ai'].includes(d.method) || !['project', 'reference'].includes(d.category) ||
          !['static', 'partial', 'inferred'].includes(d.completeness) || typeof d.readOnly !== 'boolean' ||
          (d.method === 'ai' && (d.readOnly !== true || d.completeness !== 'inferred'))) fail();
    }
    const nodes = new Set<string>();
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || nodes.has(node.id) ||
          typeof node.title !== 'string' || !['function', 'unknown', 'boundary'].includes(node.kind)) fail();
      if (node.execution !== undefined && !['function', 'callable', 'subgraph', 'unknown'].includes(node.execution)) fail();
      nodes.add(node.id); source(node.registration); source(node.implementation);
    }
    for (const edge of graph.edges) {
      if (!edge || typeof edge.id !== 'string' || !nodes.has(edge.from) || !nodes.has(edge.to) ||
          !['normal', 'conditional', 'join'].includes(edge.kind)) fail();
      source(edge.source); source(edge.routerSource);
    }
    diagnostics(graph.diagnostics);
  }
  return value as ProjectAnalysis;
}
