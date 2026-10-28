import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { Project, ProjectAnalysis } from '../../../packages/contracts/src/index.ts';
import { analysisFinished, analysisSessionStorage, createAnalysisMonitor } from './analysis-monitor.ts';

export function ConversationAI({ api, project, analysis, sessionId, onUpdated, disabled = false, automatic = false }: {
  api: ApiClient; project: Project; analysis: ProjectAnalysis; sessionId: string | null; disabled?: boolean; automatic?: boolean; onUpdated: () => Promise<void>;
}) {
  const monitor = useMemo(() => createAnalysisMonitor(api, project.id, sessionId, analysisSessionStorage()), [api, project.id, sessionId]);
  const { task, error, busy, restoring, synced, blocked, pending } = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const refreshed = useRef('');
  const openedAt = useRef(Date.now());
  useEffect(() => monitor.connect(), [monitor]);
  useEffect(() => {
    if (!disabled && task?.status === 'ready' && refreshed.current !== task.id) {
      refreshed.current = task.id;
      if (task.revision === analysis.revision && (!analysis.deepAnalysis || Date.parse(task.updatedAt) >= openedAt.current)) void onUpdated();
    }
  }, [task?.id, task?.status, disabled, analysis.revision, analysis.deepAnalysis, onUpdated]);
  const running = !!task && !analysisFinished(task);
  const hasCurrentResult = analysis.deepAnalysis?.revision === analysis.revision || analysis.architecture?.revision === analysis.revision;
  useEffect(() => {
    if (!automatic || disabled || !sessionId || hasCurrentResult) return;
    const timer = setTimeout(() => void monitor.startAutomatically(analysis.revision, hasCurrentResult), 1200);
    return () => clearTimeout(timer);
  }, [monitor, automatic, disabled, sessionId, analysis.revision, hasCurrentResult, busy, restoring, synced, blocked, pending, error, task?.id, task?.status]);
  const label = restoring ? '正在恢复后台 AI 任务' : !synced ? '重试同步 AI 任务状态' : blocked ? '项目正在另一会话解读'
    : running ? '取消当前会话 AI 解读' : pending ? '核对上次 AI 提交' : '使用当前会话 AI 解读';
  const message = restoring ? '正在查询当前会话的后台任务…' : error || (blocked ? '此项目正在另一会话中解读，完成后才能开始新任务。'
    : pending && !running ? '上次提交回执尚未确认；再次点击只按原请求编号核对，不创建新的排队请求。'
    : task?.message || (hasCurrentResult ? '已加载本版本 AI 解读。' : automatic && sessionId
      ? monitor.wasAutomaticallyAttempted(analysis.revision) ? '本版本已尝试自动解读；未取得有效结果时可点击 AI 重试。'
        : '自动解读已启用：核对源码和后台任务后，使用当前会话模型补充解读；失败或取消后可点击 AI 重试。'
      : '请在 Harness 当前会话中打开架构视图，或点击 AI 核对连接。'));
  return <div className="canvas-ai">
    <button aria-label={label} disabled={busy || restoring || blocked || (disabled && !running)}
      title={restoring || !synced || blocked || pending ? label : running ? '解读中，点击取消'
        : automatic ? '已启用自动解读；点击可手动重新解读，使用当前会话及所选模型额度。'
        : '点击即向当前 Harness 会话提交解读请求，使用该会话上下文与所选模型，可能产生模型费用。'}
      onClick={() => void monitor.click(analysis.revision)}>{running || busy || restoring ? '◌ AI' : '✦ AI'}</button>
    <details className="canvas-ai-status" open={!!error || undefined}><summary title={message}>{error || task?.status === 'failed' ? '!' : restoring ? '同步中' : running ? '进行中' : pending ? '待核对' : 'ⓘ'}</summary>
      <div><p role={error ? 'alert' : 'status'}>{message}</p>{task && <small>已读取 {task.filesRead} 个文件 · {task.id}</small>}<small>解读不执行工具；修改源码仍需单独审阅确认。</small></div>
    </details>
  </div>;
}
