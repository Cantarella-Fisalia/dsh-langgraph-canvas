import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { BehaviorSupport, BehaviorTask } from '../../../packages/contracts/src/behavior.ts';
import type { SourceTransaction } from '../../../packages/contracts/src/source-preview.ts';

export const behaviorStatus = (value: string) => ({ submitting: '等待提交回执', queued: '排队中', running: '实现中', cancelling: '等待取消确认',
  cancelled: '已取消', needs_attention: '需要核对', review_ready: '代码待审阅', failed: '未通过', conflicted: '源码冲突' })[value] || value;
const activeTask = (task: BehaviorTask) => ['submitting', 'queued', 'running', 'cancelling', 'needs_attention'].includes(task.status);

export function BehaviorStart({ api, projectId, sessionId, transaction, disabled = false, submittedTaskId, requestId, onBusy, onAccepted }: {
  api: ApiClient; projectId: string; sessionId?: string | null; transaction?: SourceTransaction; disabled?: boolean; submittedTaskId?: string;
  onBusy: (busy: boolean) => void; onAccepted: (task: BehaviorTask) => void;
  requestId?: string;
}) {
  const [support, setSupport] = useState<BehaviorSupport>({ available: false, mode: 'workspace-task', message: '正在读取节点行为通道…' });
  const [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  async function checkSupport() {
    try { const value = await api.behaviorSupport(sessionId); if (mounted.current) setSupport(value); }
    catch (e) { if (mounted.current) setSupport({ available: false, mode: 'workspace-task', message: (e as Error).message }); }
  }
  useEffect(() => { mounted.current = true; void checkSupport(); return () => { mounted.current = false; }; }, [api, sessionId]);
  async function start() {
    if (!transaction || !ack || (!support.available || support.canSubmit === false) || disabled || submittedTaskId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const value = await api.startBehavior(projectId, { schemaVersion: 1, requestId: requestId || 'behavior-' + transaction.id, transactionId: transaction.id,
        reviewHash: transaction.reviewHash, confirmed: true, sessionId: sessionId || undefined });
      if (mounted.current) onAccepted(value);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { inFlight.current = false; onBusy(false); if (mounted.current) setBusy(false); }
  }
  return <section className="behavior-start" aria-label="Harness 节点行为实现"><h3>交给 Harness 实现节点行为</h3>
    <p>{support.message}</p><p>任务会使用已确认预览的职责、State 和相关源码，在独立临时副本中实现函数。结果需重新审阅并单独确认应用。</p>
    {!transaction && <p>先点击“确认并生成源码预览”，取得确定的源码快照与职责要求。</p>}
    {submittedTaskId ? <p role="status">此草稿已提交任务：{submittedTaskId}。请在“行为任务”中查看结果。</p> : <label className="source-ack">
      <input type="checkbox" checked={ack} disabled={busy || disabled || !transaction || (!support.available || support.canSubmit === false)} onChange={e => setAck(e.target.checked)} />
      我确认让 Harness 在临时副本实现上述职责，结果仍需我审阅应用。</label>}
    {error && <p role="alert" className="editor-error">{error}</p>}
    <div className="dialog-actions"><button disabled={busy} onClick={() => void checkSupport()}>刷新行为通道状态</button>
      <button className="primary" disabled={!transaction || (!support.available || support.canSubmit === false) || !ack || disabled || !!submittedTaskId || busy} onClick={() => void start()}>
        {busy ? '正在登记任务…' : submittedTaskId ? '已提交此草稿' : '确认并交给 Harness'}</button></div>
  </section>;
}

export function BehaviorTasksPanel({ api, projectId, sessionId, initialTaskId, onReview, onBusy }: {
  api: ApiClient; projectId: string; sessionId?: string | null; initialTaskId?: string; onReview: (id: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [tasks, setTasks] = useState<BehaviorTask[]>([]), [selected, setSelected] = useState(initialTaskId || '');
  const [detail, setDetail] = useState<BehaviorTask | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const [available, setAvailable] = useState(false);
  const [retryTransaction, setRetryTransaction] = useState<SourceTransaction | null>(null);
  const mounted = useRef(true), refreshing = useRef(false), cancelling = useRef(false);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  useEffect(() => {
    mounted.current = true;
    void Promise.all([api.behaviorTasks(projectId), api.behaviorSupport(sessionId)]).then(([value, support]) => {
      if (!mounted.current) return;
      setTasks(value.tasks); setAvailable(support.available); setLoading(false);
      if (!initialTaskId) setSelected(value.tasks[0]?.id || '');
    }).catch(e => { if (mounted.current) { setError(e.message); setLoading(false); } });
    return () => { mounted.current = false; };
  }, [api, projectId, sessionId, initialTaskId]);
  async function refresh(id: string) {
    if (!id || refreshing.current) return;
    refreshing.current = true;
    try {
      const value = await api.behaviorTask(projectId, id);
      if (!mounted.current) return;
      setTasks(previous => previous.some(t => t.id === value.id) ? previous.map(t => t.id === value.id ? value : t) : [value, ...previous]);
      if (selectedRef.current === id) setDetail(value);
    } catch (e) { if (mounted.current && selectedRef.current === id) setError((e as Error).message); }
    finally { refreshing.current = false; if (mounted.current && selectedRef.current && selectedRef.current !== id) void refresh(selectedRef.current); }
  }
  useEffect(() => { setDetail(null); setError(''); setConfirmCancel(false); setRetryTransaction(null); if (selected) void refresh(selected); }, [selected]);
  useEffect(() => {
    if (!detail || !activeTask(detail) || !available) return;
    const timer = setInterval(() => void refresh(detail.id), 2500);
    return () => clearInterval(timer);
  }, [detail?.id, detail?.status, available]);
  async function cancel() {
    if (!detail || cancelling.current || !confirmCancel) return;
    cancelling.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const value = await api.cancelBehavior(projectId, detail.id);
      if (mounted.current && selectedRef.current === value.id) {
        setDetail(value); setTasks(previous => previous.map(t => t.id === value.id ? value : t)); setConfirmCancel(false);
      }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { cancelling.current = false; onBusy(false); if (mounted.current) setBusy(false); }
  }
  async function prepareRetry() {
    if (!detail) return;
    try {
      const value = await api.transaction(projectId, detail.transactionId);
      if (mounted.current && selectedRef.current === detail.id) setRetryTransaction(value.transaction || null);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
  }
  return <div className="behavior-panel"><h2>行为任务</h2>
    <p>任务修改临时源码副本；完成后生成待审阅的源码事务。关闭此面板只停止本页监视，不等于取消宿主任务。</p>
    {!available && !loading && <p className="editor-hint">当前未配置行为通道，只展示已保存记录；无法核对宿主进度或确认取消。</p>}
    {error && <p role="alert" className="editor-error">{error}</p>}
    <div className="transaction-list">{loading ? <p>正在读取任务…</p> : tasks.length ? tasks.map(task => <button key={task.id} aria-pressed={selected === task.id} disabled={busy}
      onClick={() => setSelected(task.id)}><strong>{behaviorStatus(task.status)} · {task.graphId}</strong><small>{new Date(task.createdAt).toLocaleString()} · {task.requirements.length} 项职责</small></button>)
      : <p>尚无行为任务。先编辑节点职责、生成源码预览，再明确确认交给 Harness。</p>}</div>
    {detail && <section className="behavior-detail"><h3>{behaviorStatus(detail.status)}</h3><p role="status">{detail.message}</p>
      <p className="editor-hint">任务：{detail.id}{detail.hostTaskId && <> · 宿主任务：{detail.hostTaskId}</>}</p>
      <ul>{detail.requirements.map((r, i) => <li key={i}><strong>{r.kind === 'route' ? '路由' : r.nodeId} · {r.functionRef}</strong><p>{r.description}</p>
        <small>{r.file} · {r.symbol}{r.affectedNodes.length > 1 && ' · 共享函数影响：' + r.affectedNodes.join('、')}</small></li>)}</ul>
      <div className="dialog-actions"><button disabled={busy} onClick={() => void refresh(detail.id)}>刷新任务状态</button>
        {detail.resultTransactionId && <button className="primary" onClick={() => onReview(detail.resultTransactionId!)}>审阅生成代码</button>}
        {activeTask(detail) && !detail.cancelRequested && <button disabled={busy || !available} onClick={() => setConfirmCancel(true)}>取消任务</button>}</div>
      {['failed', 'cancelled'].includes(detail.status) && <button disabled={busy || !available} onClick={() => void prepareRetry()}>准备新一次重试</button>}
      {retryTransaction && <BehaviorStart key={detail.id + '-retry'} api={api} sessionId={sessionId} projectId={projectId} transaction={retryTransaction}
        requestId={'behavior-retry-' + detail.id} onBusy={value => { setBusy(value); onBusy(value); }} onAccepted={task => { setTasks(previous => [task, ...previous.filter(t => t.id !== task.id)]); setSelected(task.id); }} />}
      {confirmCancel && <div className="cancel-confirm"><p>确认请求 Harness 停止此任务？只有宿主确认停止后才显示“已取消”，结果不会自动导入。</p>
        <button disabled={busy} onClick={() => setConfirmCancel(false)}>继续保留</button><button disabled={busy} onClick={() => void cancel()}>确认取消任务</button></div>}
    </section>}
  </div>;
}
