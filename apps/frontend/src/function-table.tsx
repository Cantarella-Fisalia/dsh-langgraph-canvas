import type { EditorGraph, EditorNode } from '../../../packages/contracts/src/editing.ts';
import type { GraphExplanation } from '../../../packages/contracts/src/explanation.ts';
import { nodeDisplayName, nodeExecution } from './explanation-view.ts';
import type { ViewMode } from './view-mode.ts';

export function FunctionTable({ graph, explanation, onSelect, viewMode }: {
  graph: EditorGraph; explanation?: GraphExplanation; onSelect: (node: EditorNode) => void; viewMode: ViewMode;
}) {
  const nodes = graph.nodes.filter(node => node.kind !== 'boundary');
  return <details className="function-table nodrag nopan nowheel">
    <summary>函数模块表 <small>{nodes.length}</small></summary>
    <section aria-label="中文功能与源码对照表">
      <p>{viewMode === 'professional' ? '按源码原始函数／注册对象名称显示。点击名称查看节点与源码。' : '中文名帮助理解流程，原函数用于定位代码。点击中文名查看节点与源码。'}</p>
      <div className="function-table-scroll"><table><thead><tr><th>{viewMode === 'professional' ? '原函数／注册对象' : '中文功能名'}</th><th>{viewMode === 'professional' ? '注册 ID／实现类型' : '原函数／注册 ID'}</th><th>职责与源码</th></tr></thead>
        <tbody>{nodes.map(node => { const item = explanation?.nodes.find(value => value.nodeId === node.id); const source = node.implementation || node.registration;
          return <tr key={node.id}><td><button onClick={() => onSelect(node)}>{nodeDisplayName(graph, node.id, explanation, viewMode)}</button>{viewMode === 'standard' && <small>{item?.displayName ? 'AI 命名' : '待 AI 命名'}</small>}</td>
            <td><code>{viewMode === 'professional' ? node.id : node.functionRef || '实现尚未解析'}</code><small>{viewMode === 'professional' ? nodeExecution(node, item).label : '注册 ID：' + node.id}</small></td>
            <td><p>{item?.summary.text || node.summary || '职责待解读'}</p>{source && <button className="function-source" onClick={() => onSelect(node)}>{source.file}:{source.line}–{source.endLine}</button>}</td></tr>;
        })}</tbody></table></div>
      {!nodes.length && <p>没有已识别的执行步骤。</p>}
    </section>
  </details>;
}
