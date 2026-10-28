import type { SourceLocation } from '../../../packages/contracts/src/index.ts';
import type { ExplainedText } from '../../../packages/contracts/src/explanation.ts';
export { explanationFor, explanationCoverage, fieldRoles, nodeExecution } from './explanation-view.ts';
export function Evidence({ sources, onSource }: { sources: SourceLocation[]; onSource: (source: SourceLocation) => void }) {
  return <span className="explanation-evidence">{sources.map((source, i) => <button key={source.file + ':' + source.line + ':' + i} title={'查看源码：' + source.file + ':' + source.line + '–' + source.endLine}
    onClick={() => onSource(source)}>{source.file.split('/').at(-1)}:{source.line}{source.endLine !== source.line ? '–' + source.endLine : ''}</button>)}</span>;
}
export function Claim({ value, onSource, missing = '尚未解读，不能仅凭名称确定。' }: { value?: ExplainedText; onSource: (source: SourceLocation) => void; missing?: string }) {
  return <div className={'explained-claim' + (!value ? ' unexplained' : '')}>{value ? <><p>{value.text}</p><Evidence sources={value.evidence} onSource={onSource} /></> : <p>{missing}</p>}</div>;
}
