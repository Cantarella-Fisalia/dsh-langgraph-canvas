import { useState } from 'react';
import type { EditorGraph } from '../../../packages/contracts/src/editing.ts';
import type { SourceLocation } from '../../../packages/contracts/src/index.ts';
import type { GraphExplanation } from '../../../packages/contracts/src/explanation.ts';
import { nodeDisplayName } from './explanation-view.ts';
import type { ViewMode } from './view-mode.ts';
import { Claim, Evidence, fieldRoles } from './explanation.tsx';

export function CanvasState({ graph, explanation, onSource, viewMode }: {
  graph: EditorGraph; explanation?: GraphExplanation; onSource: (source: SourceLocation) => void; viewMode: ViewMode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('fields');
  const [name, setName] = useState('');
  const field = graph.state.fields.find(f => f.name === name);
  const meaning = explanation?.stateFields.find(f => f.name === name);
  return <div className="canvas-state nodrag nopan">
    <button className="canvas-state-trigger" aria-expanded={open} aria-controls="canvas-state-content" onClick={() => setOpen(value => !value)}>
      <span className="state-badge">S</span> State <code>{graph.state.reference || '未识别'}</code><small>{graph.state.fields.length}</small><span>{open ? '⌃' : '⌄'}</span>
    </button>
    {open && <section id="canvas-state-content" className="canvas-state-content nowheel" aria-label="共享 State">
      <div className="state-popover-heading"><strong>查看什么？</strong><button aria-label="收起 State" onClick={() => setOpen(false)}>×</button></div>
      <div className="state-tabs">{[['fields', '变量含义'], ['usage', '读写关系'], ['source', '源码定义']].map(([id, label]) =>
        <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
      <p className="explanation-note">全图共享的数据。这里显示静态定义，实际数值会随执行变化。</p>
      {mode === 'source' ? <><code>{graph.state.reference || 'State 未识别'}</code>{graph.state.source ? <Evidence sources={[graph.state.source]} onSource={onSource} /> : <p>尚未定位定义。</p>}</> : <>
        <label className="state-field-picker">选择变量<select aria-label="选择 State 变量" value={field ? name : ''} onChange={e => setName(e.target.value)}>
          <option value="">请选择要查看的变量</option>{graph.state.fields.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select></label>
        {!graph.state.fields.length && <p>字段尚未静态展开，不代表 State 为空；可查看源码定义。</p>}
        {field && <div className="state-field-detail"><strong><code>{field.name}</code></strong><p><code>{field.annotation || '类型未识别'}</code></p>
          {mode === 'fields' ? <><small>{meaning ? fieldRoles[meaning.role] : '用途待解读'}</small><Claim value={meaning?.meaning} onSource={onSource} missing="用途尚未解读，可点击画布右上角 AI。" /></>
            : <><p>已识别读取：{meaning?.readers.map(id => nodeDisplayName(graph, id, explanation, viewMode)).join('、') || '未确认'}</p><p>已识别更新：{meaning?.writers.map(id => nodeDisplayName(graph, id, explanation, viewMode)).join('、') || '未确认'}</p><small>只列出已确认的关系，不代表完整运行轨迹。</small>{meaning && <Evidence sources={meaning.meaning.evidence} onSource={onSource} />}</>}
        </div>}
      </>}
    </section>}
  </div>;
}
