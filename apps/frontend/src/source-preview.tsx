import { useState } from 'react';
import type { SourcePreview } from '../../../packages/contracts/src/source-preview.ts';

export const transactionStatus = (status: string) => ({ prepared: '待应用', applied: '已应用', undone: '已撤销',
  applying: '应用中', undoing: '撤销中', rolled_back: '失败后已恢复', recovery_required: '需要恢复' })[status] || status;

export function SourcePreviewPanel({ preview, undo = false }: { preview: SourcePreview; undo?: boolean }) {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'diff' | 'full'>('diff');
  const file = preview.files[selected] || preview.files[0];
  const status = preview.transaction?.status;
  const diff = undo ? file?.undoDiff : file?.diff;
  return <section className="source-preview" aria-label="临时源码预览">
    <h3>源码审阅 · {status ? transactionStatus(status) : '静态结构检查通过'}</h3>
    <p>{status && status !== 'prepared' ? '此处展示事务保存的代码快照，当前文件以项目源码为准。' : '预览尚未应用；明确确认应用后才会修改原项目。'}临时副本已完成语法检查与图结构核对；这不表示业务逻辑已实现或运行验证通过。</p>
    {!!preview.placeholders.length && <p className="preview-warning">待实现函数：{preview.placeholders.join('、')}。占位函数会抛出 NotImplementedError。</p>}
    {!!preview.warnings.length && <ul className="preview-warning">{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
    {file ? <><label>查看文件<select aria-label="预览文件" value={selected} onChange={event => setSelected(Number(event.target.value))}>
      {preview.files.map((item, i) => <option value={i} key={item.file}>{item.file}</option>)}</select></label>
      <div className="preview-mode"><button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>代码差异</button><button aria-pressed={mode === 'full'} onClick={() => setMode('full')}>完整源码对照</button></div>
      {mode === 'diff' ? <pre className="unified-diff" tabIndex={0} aria-label={undo ? '撤销代码差异' : '代码差异'}>{(diff || '此文件暂无差异文本，请查看完整源码。').split('\n').map((line, i) =>
        <code key={i} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : ''}>{line || ' '}{'\n'}</code>)}</pre>
        : <div className="preview-columns">{(undo ? ['after', 'before'] as const : ['before', 'after'] as const).map((side, i) => <div key={side}><h4>{i === 0 ? '修改前' : undo ? '撤销后' : '修改后'} · {file.encoding}</h4>
          <pre tabIndex={0} aria-label={i === 0 ? '修改前源码' : '修改后源码'}><code>{file[side]}</code></pre></div>)}</div>}</>
      : <p>本草稿只包含节点职责要求，现有源码保持原样。职责实现留待 Harness 行为生成阶段。</p>}
  </section>;
}
