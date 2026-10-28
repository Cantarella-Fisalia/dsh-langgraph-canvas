import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { SourcePreview, SourceTransaction } from '../../../packages/contracts/src/source-preview.ts';
import { SourcePreviewPanel, transactionStatus } from './source-preview.tsx';
import { BehaviorStart } from './behavior.tsx';
import type { BehaviorTask } from '../../../packages/contracts/src/behavior.ts';

export function TransactionHistory({ api, projectId, sessionId, onChanged, onBusy, initialTransactionId, onTask }: {
  api: ApiClient; projectId: string; sessionId?: string | null; onChanged: (transaction: SourceTransaction) => Promise<void>; onBusy: (busy: boolean) => void;
  initialTransactionId?: string; onTask: (transaction: SourceTransaction, task: BehaviorTask) => void;
}) {
  const [transactions, setTransactions] = useState<SourceTransaction[]>([]);
  const [detail, setDetail] = useState<SourcePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ack, setAck] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  async function reload() {
    const result = await api.transactions(projectId);
    if (active.current) { setTransactions(result.transactions); setLoading(false); }
  }
  useEffect(() => {
    active.current = true;
    void reload().catch(e => { if (active.current) { setError(e.message); setLoading(false); } });
    if (initialTransactionId) void select(initialTransactionId);
    return () => { active.current = false; };
  }, [api, projectId, initialTransactionId]);
  async function select(id: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setAck(false);
    try { const value = await api.transaction(projectId, id); if (active.current) setDetail(value); }
    catch (e) { if (active.current) setError((e as Error).message); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  async function execute(operation: 'apply' | 'undo' | 'recover') {
    const tx = detail?.transaction;
    if (!tx || !ack || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    onBusy(true);
    try {
      const result = await api.sourceOperation(projectId, tx.id, operation, { schemaVersion: 1, confirmed: true,
        reviewHash: tx.reviewHash, acknowledgedWarnings: true });
      if (!active.current) return;
      setDetail(result); setAck(false); await reload();
      if (active.current && result.transaction) await onChanged(result.transaction);
    } catch (e) {
      if (active.current) {
        setError((e as Error).message);
        try { const value = await api.transaction(projectId, tx.id); if (active.current) setDetail(value); await reload(); } catch { /* Keep the actionable original error. */ }
      }
    } finally { inFlight.current = false; onBusy(false); if (active.current) setBusy(false); }
  }
  const status = detail?.transaction?.status;
  return <div className="transaction-history"><h2>源码变更记录</h2>
    <p>差异和原始字节快照保存在项目 .vislang/transactions。应用、撤销和恢复均需单独确认；外部修改会阻止覆盖。</p>
    {error && <p role="alert" className="editor-error">{error}</p>}
    <div className="transaction-list">{loading ? <p>正在读取源码变更记录…</p> : transactions.length ? transactions.map(tx => <button disabled={busy} aria-pressed={detail?.transaction?.id === tx.id} key={tx.id} onClick={() => void select(tx.id)}>
      <strong>{transactionStatus(tx.status)} · {tx.graphId}</strong><small>{new Date(tx.createdAt).toLocaleString()} · {tx.files.length} 个文件</small>{tx.message && <small>{tx.message}</small>}</button>) : <p>尚无源码变更记录。先编辑结构并确认生成预览。</p>}</div>
    {detail && <><SourcePreviewPanel key={detail.transaction?.id} preview={detail} undo={status === 'applied' || status === 'undoing'} />
      {!!detail.transaction?.message && <p role="status">{detail.transaction.message}</p>}
      {['prepared', 'applied', 'recovery_required'].includes(status || '') && !!detail.files.length && <>
        <label className="source-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />
          {status === 'prepared' ? '我已审阅所有文件差异和待实现提示，确认修改原项目。' : status === 'applied' ? '我已审阅撤销差异，确认恢复此事务之前的源码。' : '我已处理外部冲突，确认重试恢复至失败操作前的快照。'}</label>
        <div className="dialog-actions"><button className="primary" disabled={!ack || busy} onClick={() => void execute(status === 'prepared' ? 'apply' : status === 'applied' ? 'undo' : 'recover')}>
          {busy ? '正在处理…' : status === 'prepared' ? '确认应用到原项目' : status === 'applied' ? '确认撤销此次修改' : '确认重试恢复'}</button></div>
      </>}
      {detail.transaction && ['prepared', 'applied'].includes(status || '') && detail.transaction.kind !== 'behavior' &&
        <BehaviorStart key={detail.transaction.id} api={api} sessionId={sessionId} projectId={projectId} transaction={detail.transaction} disabled={busy} onBusy={value => { setBusy(value); onBusy(value); }}
          onAccepted={task => onTask(detail.transaction!, task)} />}
    </>}
  </div>;
}
