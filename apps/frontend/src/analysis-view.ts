import type { GraphDocument, ProjectAnalysis } from '../../../packages/contracts/src/index.ts';
export function projectGraphs(analysis: ProjectAnalysis | null, showReferences = false) {
  return (analysis?.graphs || []).filter(graph => showReferences || graph.discovery?.category !== 'reference');
}
export function graphReadOnly(graph: GraphDocument | null) {
  return !!graph?.discovery?.readOnly || graph?.discovery?.method === 'ai';
}
export function graphProvenance(graph: GraphDocument) {
  const source = graph.discovery?.method === 'ai' ? 'AI 推断 · 源码位置已核对' : graph.discovery?.completeness === 'partial' ? '静态读取不完整' : '静态源码识别';
  return source + (graph.discovery?.category === 'reference' ? ' · 文档／示例图' : ' · 业务图');
}
