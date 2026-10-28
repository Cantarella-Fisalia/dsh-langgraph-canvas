import { compatibleStorage } from './legacy-storage.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStructureDraft, EditorDialog } from './editor.tsx';
import type { EditorAction } from './editor.tsx';
import { previewGraph, removeDraftNode, removeDraftEdge } from '../../../packages/contracts/src/editing.ts';
import type { EditorGraph, EditorNode, EditorEdge } from '../../../packages/contracts/src/editing.ts';
import { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { SourcePreview } from '../../../packages/contracts/src/source-preview.ts';
import { SourcePreviewPanel } from './source-preview.tsx';
import { TransactionHistory } from './transactions.tsx';
import { BehaviorStart, BehaviorTasksPanel } from './behavior.tsx';
import { createWorkspaceCache, workspaceStorage } from './workspace-cache.ts';
import { ConversationAI } from './deep-analysis.tsx';
import { Claim, Evidence, explanationFor, nodeExecution } from './explanation.tsx';
import { Canvas } from './flow-canvas.tsx';
import { buildFlowchart, edgeLabel, graphCalls } from './flowchart.ts';
import type { GraphCall } from './flowchart.ts';
import { GraphNavigation } from './graph-navigation.ts';
import type { CanvasHandle } from './graph-navigation.ts';
import { nodeDisplayName } from './explanation-view.ts';
import { readViewMode, saveViewMode, viewModeNames } from './view-mode.ts';
import type { ViewMode } from './view-mode.ts';
import type { GraphExplanation } from '../../../packages/contracts/src/explanation.ts';
import { projectGraphs, graphReadOnly, graphProvenance } from './analysis-view.ts';
import type {
  Layout, Project, ProjectAnalysis, Diagnostic, SourceDocument, SourceLocation,
} from '../../../packages/contracts/src/index.ts';

function nodeName(id: string, graph?: EditorGraph | null, explanation?: GraphExplanation, viewMode: ViewMode = 'standard') {
  if (graph) return nodeDisplayName(graph, id, explanation, viewMode);
  return id === '__start__' ? 'START · 入口' : id === '__end__' ? 'END · 结束' : id;
}
function Inspector({ node, edge, graph, explanation, viewMode, calls, onOpenGraph, api, project, jump, onEdgeSelect, onClose, onSource }: {
  node: EditorNode | null; edge: EditorEdge | null; graph: EditorGraph | null; api: ApiClient; project: Project | null;
  jump: SourceLocation | null; onEdgeSelect: (edge: EditorEdge) => void; onClose: () => void;
  viewMode: ViewMode; explanation?: GraphExplanation; onSource: (source: SourceLocation) => void;
  calls: GraphCall[]; onOpenGraph: (id: string) => void;
}) {
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [error, setError] = useState('');
  const target = jump || edge?.source || node?.implementation || node?.registration;
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true; setSource(null); setError('');
    if (project && target) api.source(project.id, target.file).then(s => { if (active) setSource(s); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [api, project?.id, target?.file, target?.line, graph?.revision]);
  useEffect(() => {
    const box = container.current;
    const line = box?.querySelector('.source-line.highlight') as HTMLElement | null;
    if (box && line) box.scrollTop = Math.max(0, line.offsetTop - box.clientHeight / 3);
  }, [source, target?.line]);
  const incoming = graph?.edges.filter(e => e.to === node?.id) || [];
  const outgoing = graph?.edges.filter(e => e.from === node?.id) || [];
  const joinSources = edge?.kind === 'join' && edge.joinId
    ? [...new Set(graph?.edges.filter(e => e.kind === 'join' && e.joinId === edge.joinId).map(e => e.from))] : [];
  const fanOut = edge?.kind === 'normal' && new Set(graph?.edges.filter(e => e.kind === 'normal' && e.from === edge.from).map(e => e.to)).size > 1;
  const explainedNode = explanation?.nodes.find(n => n.nodeId === node?.id);
  const condition = edge?.pending ? undefined : explanation?.conditions.find(c => c.edgeId === edge?.id)?.when;
  const decision = edge?.kind === 'conditional' && graph ? buildFlowchart(graph).decisions.find(d => d.edges.some(e => e.id === edge.id)) : undefined;
  return <aside className="inspector" aria-label="LangGraph 结构详情">
    <div className="section-heading"><span>{edge ? '连线详情' : jump ? '源码证据' : '节点详情'}</span><button className="inspector-close" aria-label="收起结构详情" onClick={onClose}>×</button></div>

    {!node && !edge && !jump ? <div className="inspector-empty"><div className="large-symbol">⌖</div><h3>节点做什么，边走向哪里</h3><p>点击节点查看职责和函数；点击连线查看流转、条件或汇合规则。</p><p>共享 State 可在画布左上角按需查看。</p></div> : <>
      <div className="inspector-summary"><span className="eyebrow">{edge ? edgeLabel(edge, graph) : jump ? '源码证据' : node?.kind === 'boundary' ? '流程边界' : node ? nodeExecution(node, explainedNode).label : '节点实现'}</span>
        {(node?.pending || edge?.pending) && <p className="pending-source-note">此项是尚未应用的结构草稿；已有源码仅供参考，新建项尚无源码位置。</p>}
        <h2>{edge ? '执行流转' : node ? nodeName(node.id, graph, explanation, viewMode) : '源码位置'}</h2>
        {edge ? <>
          <div className="edge-endpoints"><code>{nodeName(edge.from, graph, explanation, viewMode)}</code><span>↓</span><code>{nodeName(edge.to, graph, explanation, viewMode)}</code></div>
          <p>{edge.kind === 'conditional' ? '路由函数返回对应分支值时，选择此路径。'
            : edge.kind === 'join' ? '等待同一汇合组中的所有前置节点完成，再执行目标节点。'
            : fanOut ? '该来源有多条普通出边，会向多个目标分发；这些普通出边均会触发。'
            : '来源节点完成后，沿箭头进入目标节点。多条普通入边不等同于等待全部完成。'}</p>
          {edge.kind === 'conditional' && <dl className="edge-properties"><dt>分支值</dt><dd><code>{edge.label === '' ? '""' : edge.label ?? '未识别'}</code></dd><dt>路由函数</dt><dd><code>{edge.route || '未识别'}</code></dd></dl>}
          {decision && <div className="decision-branches"><h4>此判断的全部分支</h4><p>菱形展示已有路由，不是新增业务节点。各分支可能选择一个或多个目标，取决于路由函数。</p>{decision.edges.map(branch => <button key={branch.id} className={branch.id === edge.id ? 'active' : ''} onClick={() => onEdgeSelect(branch)}><code>{branch.label === '' ? '""' : branch.label ?? '未识别分支值'}</code><span>→ {nodeName(branch.to, graph, explanation, viewMode)}</span></button>)}</div>}
          {edge.kind === 'conditional' && <><h4>实际判断条件 · AI 解读</h4><Claim value={condition} onSource={onSource} missing="尚未解读实际条件，分支值不等于条件。可用 AI 读取路由函数后解释。" />
            {edge.routerSource && !condition?.evidence.some(s => s.file === edge.routerSource!.file && s.line === edge.routerSource!.line && s.endLine === edge.routerSource!.endLine) && <Evidence sources={[edge.routerSource]} onSource={onSource} />}</>}
          {edge.kind === 'join' && <dl className="edge-properties"><dt>全部前置节点</dt><dd>{joinSources.length ? joinSources.map(id => <code key={id}>{nodeName(id, graph, explanation, viewMode)}</code>) : <code>{nodeName(edge.from, graph, explanation, viewMode)}（汇合组未识别）</code>}</dd></dl>}
        </> : <>
          {(jump || node?.kind === 'boundary' || !explainedNode) && <p>{jump ? '下方高亮为这条解释或诊断引用的源码。位置核对不代表 AI 解释的含义已经验证。' : node?.summary || (node?.kind === 'boundary' ? (node.id === '__start__' ? '图的执行入口，不是业务函数。' : '图的结束标记，不是业务函数。') : '此节点尚未提供职责说明，请查看实现源码。')}</p>}
          {node && node.kind !== 'boundary' && <><label className="detail-label">注册 ID</label><code className="function-ref">{node.id}</code></>}
          {viewMode === 'standard' && explainedNode?.displayName && <><label className="detail-label">中文功能名 · AI 命名依据</label><Evidence sources={explainedNode.displayName.evidence} onSource={onSource} /></>}
          {node?.functionRef && <><label className="detail-label">{nodeExecution(node, explainedNode).execution === 'function' ? '实现函数' : '注册对象'}</label><code className="function-ref">{node.functionRef}</code></>}
          {!!calls.length && <div className="call-details"><h4>调用其他图 · AI 依据</h4>{calls.map(call => <div key={call.target.id + call.relationship.kind}>
            <button onClick={() => onOpenGraph(call.target.id)}>展开子图 · {call.target.title} →</button>
            <Claim value={call.relationship.explanation} onSource={onSource} />
            {!!call.relationship.callPath.length && <details><summary>调用链与源码</summary>{call.relationship.callPath.map((step, index) => <div key={index}><code>{step.name}</code><Evidence sources={[step.source]} onSource={onSource} /></div>)}</details>}
          </div>)}</div>}
          {explainedNode && <><h4>这个节点做什么 · AI 解读</h4><Claim value={explainedNode.summary} onSource={onSource} />
            <p>已识别读取：{explainedNode.reads.join('、') || '未确认'}<br />已识别更新：{explainedNode.writes.join('、') || '未确认'}</p>
            {!!explainedNode.calls.length && <details><summary>内部调用 · 仍属于这个节点</summary>{explainedNode.calls.map((call, i) => <div key={i}><code>{call.name}</code><Evidence sources={[call.source]} onSource={onSource} /></div>)}</details>}</>}
          {node?.kind === 'boundary' && <Claim value={node.id === '__start__' ? explanation?.entry : explanation?.exit} onSource={onSource}
            missing={node.id === '__start__' ? 'START 是接收输入并进入首个步骤的虚拟标记；具体输入还需查看调用入口。' : 'END 是本次图执行结束的虚拟标记；返回什么取决于输出 schema 和调用包装函数。'} />}
          {node?.kind !== 'boundary' && !jump && <p className="detail-note">“节点”表示图中的计算步骤，不自动等同于一个智能体。</p>}
        </>}
      </div>
      {node && <div className="node-connections">{[['进入此节点', incoming], ['离开此节点', outgoing]].map(([title, items]) => <div key={title as string}><h4>{title as string}<small>{(items as EditorEdge[]).length} 条</small></h4>
        {(items as EditorEdge[]).length ? (items as EditorEdge[]).map(item => <button key={item.id} onClick={() => onEdgeSelect(item)}><span>{nodeName(item.from, graph, explanation, viewMode)} → {nodeName(item.to, graph, explanation, viewMode)}</span><small>{edgeLabel(item, graph)}</small></button>) : <p className="muted">无已识别连线</p>}
      </div>)}</div>}
      {target && <div className="source-section"><h4>{edge ? '连线注册源码' : jump ? '解释／诊断依据' : '对应源码'} <small>{target.line}–{target.endLine} 行</small></h4>
        <div className="source-path" title={target.file}>{target.file}</div>
        {error ? <p className="error">{error}</p> : !source ? <p className="muted">正在读取源码…</p> :
          <div ref={container} className="source-code">{source.content.split('\n').map((line, index) =>
            <div className={'source-line ' + (index + 1 >= target.line && index + 1 <= target.endLine ? 'highlight' : '')} key={index}>
              <span>{index + 1}</span><code>{line || ' '}</code></div>)}</div>}
      </div>}
    </>}
  </aside>;
}
export function App({ apiBase = '/api/v1', embedded = false, workspaceRoot = null, sessionId = null, colorScheme = 'light' }: {
  apiBase?: string; embedded?: boolean; workspaceRoot?: string | null; sessionId?: string | null; colorScheme?: 'light' | 'dark';
}) {
  const api = useMemo(() => new ApiClient(apiBase), [apiBase]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode());
  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);
  const viewCache = useMemo(() => createWorkspaceCache(apiBase, workspaceStorage()), [apiBase]);
  const requestedWorkspace = useRef('');
  const [verified, setVerified] = useState(false);
  const [root, setRoot] = useState(() => {
    if (embedded) return workspaceRoot || '';
    try { return compatibleStorage(localStorage)?.getItem('dsh-langgraph-canvas:lastRoot') || ''; } catch { return ''; }
  });
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [graphId, setGraphId] = useState('');
  const activeGraphId = useRef(graphId);
  activeGraphId.current = graphId;
  const canvasRef = useRef<CanvasHandle>(null);
  const navigation = useMemo(() => new GraphNavigation(apiBase + '|' + project?.id + '|' + analysis?.revision), [apiBase, project?.id, analysis?.revision]);
  const [layoutState, setLayoutState] = useState<{ graphId: string; value: Layout } | null>(null);
  const layout = layoutState?.graphId === graphId ? layoutState.value : null;
  const setLayout = (value: Layout | null, id = graphId) => setLayoutState(value ? { graphId: id, value } : null);
  const [node, setNode] = useState<EditorNode | null>(null);
  const [edge, setEdge] = useState<EditorEdge | null>(null);
  const [jump, setJump] = useState<SourceLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [connection, setConnection] = useState('尚未连接项目');
  const [editMode, setEditMode] = useState(false);
  const [action, setAction] = useState<EditorAction | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const generation = useRef(0);
  const [showReferences, setShowReferences] = useState(false);
  const visibleGraphs = useMemo(() => projectGraphs(analysis, showReferences), [analysis, showReferences]);
  const baseGraph = visibleGraphs.find(g => g.id === graphId) || visibleGraphs[0] || null;
  const explanation = explanationFor(analysis, baseGraph?.id);
  const readOnlyGraph = graphReadOnly(baseGraph);
  const allowedGraphIds = visibleGraphs.map(g => g.id);
  const backGraphId = navigation.previous(baseGraph?.id || '', allowedGraphIds);
  const backGraph = visibleGraphs.find(g => g.id === backGraphId);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || navigation.hasUnsaved(baseGraph?.id)) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, navigation, baseGraph?.id]);
  useEffect(() => {
    if (baseGraph && graphId !== baseGraph.id) setGraphId(baseGraph.id);
  }, [baseGraph?.id, graphId]);
  const editor = useStructureDraft(project?.id, baseGraph);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [sourceAck, setSourceAck] = useState(false);
  const previewKey = project?.id + '/' + graphId + '/' + editor.draft?.requestId + '/' + baseGraph?.revision;
  const activePreviewKey = useRef(previewKey);
  activePreviewKey.current = previewKey;
  useEffect(() => { setSourcePreview(null); setSourceAck(false); }, [previewKey]);
  const graph = useMemo(() => baseGraph && editor.target && !editor.stale && !readOnlyGraph ? previewGraph(baseGraph, editor.target) : baseGraph, [baseGraph, editor.target, editor.stale, readOnlyGraph]);
  const calls = useMemo(() => graph ? graphCalls(analysis, graph, visibleGraphs) : new Map(), [analysis, graph, visibleGraphs]);
  const diagnostics = [...(analysis?.diagnostics || []), ...(graph?.diagnostics || [])];
  const editable = verified && !readOnlyGraph && editMode && !editor.stale && !editor.draft?.receipt && !submitting;
  useEffect(() => { setEditMode(false); setAction(null); setReviewError(''); }, [project?.id, graphId, readOnlyGraph]);
  function openAction(value: EditorAction) { if (!verified) return; setReviewError(''); setAction(value); }
  function commitDraft(target: Parameters<typeof editor.change>[0]) {
    if (!verified || readOnlyGraph) return;
    editor.change(target); setNode(null); setEdge(null); setJump(null);
  }
  async function confirmSourcePreview() {
    const draft = editor.draft;
    if (!verified || readOnlyGraph || !draft || !project || editor.stale || editor.issues.length || !editor.changes.length || submissionInFlight.current) return;
    const key = previewKey;
    submissionInFlight.current = true; setSubmitting(true); setReviewError('');
    try {
      const result = await api.sourcePreview(project.id, { schemaVersion: 1, requestId: draft.requestId,
        graphId: draft.graphId, baseRevision: draft.baseRevision, target: draft.target, confirmed: true });
      if (activePreviewKey.current === key) { setSourcePreview(result); setSourceAck(false); }
    } catch (e) { if (activePreviewKey.current === key) setReviewError((e as Error).message); }
    finally { submissionInFlight.current = false; setSubmitting(false); }
  }
  async function confirmSourceApply() {
    const tx = sourcePreview?.transaction;
    if (!verified || readOnlyGraph || !project || !tx || tx.status !== 'prepared' || !sourcePreview?.files.length || !sourceAck || editor.stale || editor.draft?.receipt || submissionInFlight.current) return;
    const current = generation.current, key = previewKey;
    submissionInFlight.current = true; setSubmitting(true); setReviewError('');
    try {
      const result = await api.sourceOperation(project.id, tx.id, 'apply', { schemaVersion: 1, confirmed: true,
        reviewHash: tx.reviewHash, acknowledgedWarnings: true });
      if (current !== generation.current) return;
      editor.clear(); setSourcePreview(null); setSourceAck(false); setAction(null); setEditMode(false);
      setNode(null); setEdge(null); setJump(null); await refresh();
      setMessage(result.transaction?.message || '源码已应用，可在源码变更记录中撤销。');
    } catch (e) {
      if (current === generation.current) {
        setReviewError((e as Error).message + ' 可在“源码变更记录”核对状态。');
        try { const value = await api.transaction(project.id, tx.id); if (activePreviewKey.current === key) setSourcePreview(value); } catch { /* Keep original error. */ }
      }
    } finally { submissionInFlight.current = false; setSubmitting(false); }
  }
  const loadProject = useCallback(async (requestedRoot: string, fromHost = false) => {
    if (!requestedRoot.trim()) { setError('请输入 LangGraph 项目的绝对目录。'); return; }
    const current = ++generation.current;
    requestedWorkspace.current = requestedRoot.trim();
    const cached = viewCache.read(requestedRoot.trim());
    setVerified(false);
    if (cached) {
      const selected = projectGraphs(cached.analysis, cached.references).find(g => g.id === cached.graphId)?.id || projectGraphs(cached.analysis, cached.references)[0]?.id || '';
      setProject(cached.project); setAnalysis(cached.analysis); setGraphId(selected); setShowReferences(cached.references);
      const storedLayout = cached.layouts[selected];
      setLayout(storedLayout?.revision === cached.analysis.revision ? storedLayout.value : null, selected);
    } else { setProject(null); setAnalysis(null); setGraphId(''); setLayout(null); setShowReferences(false); }
    setNode(null); setEdge(null); setJump(null); setDirty(false);
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api.openProject(requestedRoot.trim(), fromHost);
      if (current !== generation.current) return;
      setProject(data.project); setAnalysis(data.analysis); setVerified(true);
      setGraphId(previous => projectGraphs(data.analysis, cached?.references).some(g => g.id === previous) ? previous : projectGraphs(data.analysis, cached?.references)[0]?.id || '');
      if (!fromHost) { try { compatibleStorage(localStorage)?.setItem('dsh-langgraph-canvas:lastRoot', data.project.root); } catch { /* Optional preview preference. */ } }

    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) setBusy(false); }
  }, [api, viewCache]);
  function openProject() {
    if ((dirty || navigation.hasUnsaved(baseGraph?.id)) && !window.confirm('当前存在尚未保存的布局，仍要打开其他项目吗？')) return;
    void loadProject(root);
  }
  useEffect(() => {
    if (!embedded) return;
    ++generation.current;
    setProject(null); setAnalysis(null); setGraphId(''); setLayout(null); setVerified(false);
    setNode(null); setEdge(null); setJump(null); setDirty(false); setError(''); setMessage('');
    setConnection('尚未连接项目'); setBusy(false);
    setShowReferences(false);
    setRoot(workspaceRoot || '');
    if (workspaceRoot) void loadProject(workspaceRoot, true);
    return () => { ++generation.current; };
  }, [embedded, workspaceRoot, loadProject]);
  const refresh = useCallback(async () => {
    if (!project || !verified) return;
    const current = generation.current;
    try {
      const result = await api.graphs(project.id);
      if (current !== generation.current) return;
      setAnalysis(result);
      setGraphId(previous => projectGraphs(result, showReferences).some(g => g.id === previous) ? previous : projectGraphs(result, showReferences)[0]?.id || '');
      setNode(previous => previous ? result.graphs.find(g => g.id === activeGraphId.current)?.nodes.find(n => n.id === previous.id) || null : null);
      setEdge(previous => previous ? result.graphs.find(g => g.id === activeGraphId.current)?.edges.find(e => e.id === previous.id) || null : null);
      setError('');
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
  }, [api, project?.id, showReferences, verified]);
  useEffect(() => {
    if (!project || !graphId) return;
    const cached = viewCache.read(requestedWorkspace.current)?.layouts[graphId];
    setLayout(cached && cached.revision === analysis?.revision ? cached.value : null);
    if (!verified) return;
    let active = true;
    api.layout(project.id, graphId).then(value => { if (active) setLayout(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [api, project?.id, graphId, analysis?.revision, verified, viewCache]);
  useEffect(() => {
    if (!project || !verified) return;
    const events = api.events(project.id);
    events.onopen = () => setConnection('实时同步已连接');
    events.onerror = () => setConnection('连接恢复中，可手动刷新');
    events.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'project.changed') void refresh();
      } catch { setConnection('事件异常，可手动刷新'); }
    };
    return () => events.close();
  }, [api, project?.id, refresh, verified]);
  useEffect(() => {
    if (!project || !analysis || !verified || busy || !requestedWorkspace.current) return;
    const previous = viewCache.read(requestedWorkspace.current);
    const layouts = previous?.analysis.revision === analysis.revision ? { ...previous.layouts } : {};
    if (layoutState && analysis.graphs.some(g => g.id === layoutState.graphId)) layouts[layoutState.graphId] = { revision: analysis.revision, value: layoutState.value };
    viewCache.write(requestedWorkspace.current, { project, analysis, graphId, references: showReferences, layouts });
  }, [viewCache, project, analysis, graphId, showReferences, layoutState, verified, busy]);
  const rememberCurrentView = () => {
    const value = canvasRef.current?.capture();
    if (value && value.graphId === baseGraph?.id && value.sourceRevision === baseGraph.revision) navigation.remember(value);
  };
  const showGraph = (id: string) => {
    const target = visibleGraphs.find(g => g.id === id);
    if (!target) return;
    const view = navigation.view(id, target.revision);
    setGraphId(id);
    setNode(target.nodes.find(n => n.id === view?.selectedNodeId) || null);
    setEdge(target.edges.find(e => e.id === view?.selectedEdgeId) || null);
    setJump(null); setDirty(false);
  };
  const chooseGraph = (id: string) => {
    rememberCurrentView();
    const target = navigation.choose(baseGraph?.id || '', id, allowedGraphIds);
    if (target) showGraph(target);
  };
  const openSubgraph = (id: string) => {
    rememberCurrentView();
    const target = navigation.open(baseGraph?.id || '', id, allowedGraphIds);
    if (target) showGraph(target);
  };
  const returnGraph = () => {
    rememberCurrentView();
    const target = navigation.back(baseGraph?.id || '', allowedGraphIds);
    if (target) showGraph(target);
  };
  const selectEdge = (item: EditorEdge) => { setEdge(item); setNode(null); setJump(null); };
  const openEvidence = (source: SourceLocation) => { setNode(null); setEdge(null); setJump(source); };
  return <div className={'workbench langgraph-workbench' + (embedded ? ' embedded-workbench' : '')}>
    <main className="main">
      {!embedded && <form className="project-toolbar" onSubmit={event => { event.preventDefault(); openProject(); }}>
        <label htmlFor="project-root">LangGraph 项目目录</label>
        <input id="project-root" value={root} onChange={e => setRoot(e.target.value)} placeholder="项目绝对目录" spellCheck={false} />
        <button className="primary" type="submit" disabled={busy}>{busy ? '正在读取…' : '打开项目'}</button>
      </form>}
      <header className="graph-heading"><div className="graph-title"><div className="eyebrow">LANGGRAPH</div>
        <h1>{graph ? 'LangGraph 结构' : 'LangGraph 结构视图'}</h1>
        <p className="graph-location" title={project?.root || workspaceRoot || ''}>{project?.name || (embedded ? '当前 Harness 工作区' : '尚未打开项目')}{graph && <> · <code>{graph.file} · {graph.symbol}</code></>}</p>
      </div><div className="graph-heading-actions">
        {backGraph && <button className="graph-return" aria-label="返回上一个图" title={'返回 ' + backGraph.title} onClick={returnGraph}>← 返回 {backGraph.title}</button>}
        <label className="view-mode-picker">显示模式<select aria-label="显示模式" value={viewMode} onChange={event => setViewMode(event.target.value as ViewMode)}>{Object.entries(viewModeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {visibleGraphs.length > 1 ? <label className="graph-switch">当前图 · {visibleGraphs.length} 个
          <select aria-label="选择 LangGraph" value={baseGraph?.id || ''} onChange={event => chooseGraph(event.target.value)}>
            {visibleGraphs.map(g => <option key={g.id} value={g.id}>{g.title} · {g.file}{g.scope ? ' · ' + g.scope : ''}</option>)}
          </select></label> : graph && <span className="single-graph">当前图 <code>{graph.title}</code></span>}
        <button disabled={!project || busy} onClick={() => void (verified ? refresh() : loadProject(requestedWorkspace.current, embedded))}>↻ 刷新源码</button>
        <button disabled={!project || !verified || submitting} onClick={() => openAction({ kind: 'history' })}>变更记录</button>
        <button disabled={!project || !verified || submitting} onClick={() => openAction({ kind: 'tasks' })}>行为任务</button>
      </div></header>
      {(error || message) && <div role={error ? 'alert' : 'status'} className={'notice ' + (error ? 'error' : '')}><span>{error || message}</span><button aria-label="关闭提示" onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
      {project && <details className="analysis-scope" aria-label="读取范围与来源"><summary>来源与读取范围</summary><div className="scope-content">
        <div>工作区目录：<code>{project.root}</code></div>
        <div>已扫描 {analysis?.scannedFiles || 0} 个 Python 文件 · 业务图 {analysis?.graphs.filter(g => g.discovery?.category !== 'reference').length || 0} 张 · 文档／示例图 {analysis?.graphs.filter(g => g.discovery?.category === 'reference').length || 0} 张（默认隐藏）</div>
        {!!analysis?.graphs.some(g => g.discovery?.category === 'reference') && <label><input type="checkbox" checked={showReferences} onChange={event => { if (dirty && !window.confirm('切换读取范围会丢弃未保存的布局，是否继续？')) return; setShowReferences(event.target.checked); setNode(null); setEdge(null); setJump(null); setDirty(false); }} />显示文档／示例图</label>}
        {baseGraph && <div><strong>{graphProvenance(baseGraph)}</strong> · <code>{baseGraph.id}</code></div>}
        {graph?.discovery?.readOnly && <p className="draft-warning">{graph.discovery.reason || '此结构尚不能可靠映射到可写源码，当前只读。'}</p>}
        {analysis?.scan?.limitReached && <p role="alert">达到扫描上限，当前结果不完整。</p>}
      </div></details>}
      {graph && !readOnlyGraph && <div className="draft-toolbar" aria-label="LangGraph 结构编辑">
        <button disabled={!verified || editor.stale || !!editor.draft?.receipt || submitting} className={editMode ? 'primary' : ''} onClick={() => setEditMode(value => !value)}>{editMode ? '退出编辑' : editor.draft ? '继续编辑草稿' : '编辑结构'}</button>
        {editMode && <><button disabled={!editable} onClick={() => openAction({ kind: 'node' })}>＋ 新增节点</button>
          <button disabled={!editable} onClick={() => openAction({ kind: 'edge' })}>＋ 新增连线</button>
          <button disabled={!editable} onClick={() => openAction({ kind: 'state' })}>编辑 State</button></>}
        <span className="draft-status">{editor.draft?.receipt ? '请求已接收 · 源码尚未应用' : editor.draft ? '本地草稿 · ' + editor.changes.length + ' 项修改' : '编辑只记录草稿，确认后才提交'}</span>
        {editor.draft && <><button disabled={submitting} onClick={() => openAction({ kind: 'discard' })}>放弃本地草稿</button>
          <button className="primary" disabled={submitting} onClick={() => openAction({ kind: 'review' })}>查看修改并确认</button></>}
      </div>}
      {editor.stale && <div role="alert" className="draft-warning">源码版本已变化，旧草稿仍保留，当前画布显示最新源码。请查看旧草稿清单，再放弃并重新编辑；旧草稿不能提交。</div>}
      {editor.storageError && <div role="alert" className="draft-warning">{editor.storageError}</div>}
      {editable && (node || edge) && <div className="selection-editor"><span>已选{node ? '节点 ' + nodeName(node.id, graph, explanation, viewMode) : '连线 ' + nodeName(edge!.from, graph, explanation, viewMode) + ' → ' + nodeName(edge!.to, graph, explanation, viewMode)}</span>
        {node && node.kind !== 'boundary' && <><button onClick={() => openAction({ kind: 'node', node: editor.target?.nodes.find(n => n.id === node.id) })}>编辑节点</button>
          <button onClick={() => { const item = editor.target?.nodes.find(n => n.id === node.id); if (item) openAction({ kind: 'delete-node', node: item }); }}>移除节点</button></>}
        {edge && <><button onClick={() => openAction({ kind: 'edge', edge })}>编辑连线</button><button onClick={() => openAction({ kind: 'delete-edge', edge })}>移除连线</button></>}
        {node?.kind === 'boundary' && <small>START / END 为固定流程边界，可调整其连线。</small>}
      </div>}
      <div className="editor-area"><section className="canvas-shell" aria-label="LangGraph 节点与连线">
        {graph && layout && project ? <ReactFlowProvider key={project.id + graph.id}><Canvas graph={graph} analysis={analysis} visibleGraphs={visibleGraphs} viewMode={viewMode} captureRef={canvasRef} initialView={navigation.view(graph.id, graph.revision)} onOpenGraph={openSubgraph} explanation={explanation} onSource={openEvidence} layout={layout} onLayoutSaved={value => setLayout(value)} api={api} projectId={project.id} colorScheme={colorScheme}
          onSelect={n => { setNode(n); setEdge(null); setJump(null); }} selectedNodeId={node?.id} onEdgeSelect={selectEdge} selectedEdgeId={edge?.id} onDirty={setDirty} onMessage={setMessage}
          verified={verified} editable={editable} hasDraft={!!editor.draft} layoutNodeIds={baseGraph?.nodes.map(n => n.id) || []}
          onCreateConnection={(source, target) => openAction({ kind: 'edge', source, target })} /></ReactFlowProvider>
          : <div className="empty-canvas"><div className="empty-orbit"><span>◇</span><i /></div>
            <h2>{busy ? '正在读取 LangGraph…' : graph ? '准备结构画布…' : project ? '尚未找到业务 LangGraph' : '先打开 LangGraph 项目'}</h2>
            <p>{project ? '文档与示例默认隐藏。请核对上方工作区目录；可使用 AI 深度解析追踪跨文件构图，或明确勾选查看参考图。' : embedded ? '在 Harness 中选择项目工作区，结构视图会自动读取相同目录。' : '输入项目目录，直接查看图的 State、节点和执行路径。'}</p>
          </div>}
        {project && analysis && <ConversationAI key={project.id + sessionId} api={api} project={project} analysis={analysis} sessionId={sessionId} onUpdated={refresh} disabled={!verified} automatic={embedded} />}
      </section>{(node || edge || jump) && <Inspector node={node} edge={edge} jump={jump} graph={graph} viewMode={viewMode}
        calls={node ? calls.get(node.id) || [] : []} onOpenGraph={openSubgraph} explanation={explanation} api={api} project={project} onSource={openEvidence}
        onEdgeSelect={selectEdge} onClose={() => { setNode(null); setEdge(null); setJump(null); }} />}</div>
      <details className="diagnostics"><summary className="diagnostic-header"><strong>解析诊断 <span>{diagnostics.length}</span></strong>
        <small className={diagnostics.length ? 'has-diagnostics' : ''}>{diagnostics.length ? '有 ' + diagnostics.length + ' 项需查看' : analysis ? '当前支持范围内未发现问题' : '等待打开项目'}</small>
        <span className="sync-status">{project ? !verified ? busy ? '缓存视图 · 后台核对源码中' : '缓存视图 · 点刷新重新核对' : connection : '静态结构 · 不执行用户代码'}</span></summary>
        <div className="diagnostic-list">{diagnostics.length ? diagnostics.map((d: Diagnostic, i) => <button key={i} className={'diagnostic ' + d.severity} disabled={!d.source} onClick={() => { if (d.source) openEvidence(d.source); }}><span>{d.severity === 'error' ? '!' : '△'}</span><div>{d.message}<small>{d.source ? d.source.file + ':' + d.source.line : d.code}</small></div><span>↗</span></button>)
          : <div className="diagnostic-clear">未识别的动态结构会在此提示；静态定义不代表实际运行结果。</div>}</div>
      </details>
    </main>
    <EditorDialog key={action?.kind === 'node' ? 'node-' + action.node?.id : action?.kind === 'edge' ? 'edge-' + action.edge?.id : action?.kind || 'closed'}
      action={action} target={editor.target} onSave={commitDraft} onClose={() => { if (!submitting) setAction(null); }}>
      {action?.kind === 'review' && <div className="review-draft"><h2>确认结构修改</h2>
        <p className="editor-hint">项目：{project?.root}<br />图：{baseGraph?.id}</p>
        <p>先确认生成源码预览，审阅所有文件差异和提示，再单独确认应用到原项目。只有“确认并交给 Harness”会调用宿主编码通道。</p>
        <ol className="draft-change-list">{editor.changes.map((change, index) => <li key={index}><strong>{change.label}</strong><small>{change.detail}</small></li>)}</ol>
        {editor.stale && <p className="editor-error">源码已变化，旧草稿不能提交。</p>}
        {!!editor.issues.length && <div role="alert" className="draft-validation"><strong>请先修正草稿</strong><ul>{editor.issues.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {editor.draft?.receipt && <p role="status">行为请求已登记：<code>{editor.draft.receipt.taskId}</code>。请到“行为任务”查看结果；此结构预览不再直接应用。</p>}
        {reviewError && <p role="alert" className="editor-error">{reviewError}</p>}
        {sourcePreview && !editor.stale && <SourcePreviewPanel key={sourcePreview.requestId} preview={sourcePreview} />}
        {sourcePreview?.transaction?.status === 'prepared' && !!sourcePreview.files.length && !editor.stale && !editor.draft?.receipt && <label className="source-ack">
          <input type="checkbox" checked={sourceAck} disabled={submitting} onChange={e => setSourceAck(e.target.checked)} />我已审阅所有文件差异和待实现提示，确认修改原项目。</label>}
        <div className="dialog-actions"><button disabled={submitting} onClick={() => setAction(null)}>返回草稿</button>
          <button disabled={!editor.draft || editor.stale || !!editor.issues.length || !editor.changes.length || submitting}
            onClick={() => void confirmSourcePreview()}>{submitting ? '正在处理…' : sourcePreview ? '重新检查源码预览' : '确认并生成源码预览'}</button>
          {sourcePreview?.transaction?.status === 'prepared' && !!sourcePreview.files.length && <button className="primary" disabled={!sourceAck || editor.stale || submitting || !!editor.draft?.receipt}
            onClick={() => void confirmSourceApply()}>确认应用到原项目</button>}
          </div>
        {project && <BehaviorStart key={sourcePreview?.transaction?.id || editor.draft?.requestId || 'empty'} api={api} sessionId={sessionId} projectId={project.id} transaction={sourcePreview?.transaction}
          disabled={editor.stale || !!editor.issues.length || submitting} submittedTaskId={editor.draft?.receipt?.taskId}
          onBusy={value => { submissionInFlight.current = value; setSubmitting(value); }}
          onAccepted={task => {
            if (editor.draft) editor.accept({ requestId: editor.draft.requestId, taskId: task.id, status: 'accepted', message: task.message });
            setAction({ kind: 'tasks', taskId: task.id });
          }} />}
      </div>}
      {action?.kind === 'history' && project && <TransactionHistory key={project.id + sessionId} api={api} sessionId={sessionId} projectId={project.id} initialTransactionId={action.transactionId}
        onBusy={value => { submissionInFlight.current = value; setSubmitting(value); }}
        onTask={(tx, task) => {
          if (editor.draft?.requestId === tx.requestId) editor.accept({ requestId: editor.draft.requestId, taskId: task.id, status: 'accepted', message: task.message });
          setAction({ kind: 'tasks', taskId: task.id });
        }}
        onChanged={async tx => {
          if (editor.draft && [tx.requestId, tx.originRequestId].includes(editor.draft.requestId)) editor.clear();
          setNode(null); setEdge(null); setJump(null); await refresh(); setMessage(tx.message);
        }} />}
      {action?.kind === 'tasks' && project && <BehaviorTasksPanel key={project.id + sessionId} api={api} sessionId={sessionId} projectId={project.id} initialTaskId={action.taskId}
        onBusy={value => { submissionInFlight.current = value; setSubmitting(value); }} onReview={id => setAction({ kind: 'history', transactionId: id })} />}
      {(action?.kind === 'delete-node' || action?.kind === 'delete-edge') && <div className="review-draft"><h2>{action.kind === 'delete-node' ? '从草稿移除节点' : '从草稿移除连线'}</h2>
        <p>{action.kind === 'delete-node' ? '移除 ' + action.node.id + ' 及其相关连线；关联汇合按整组移除。保留 Python 业务函数。'
          : action.edge.kind === 'join' ? '此连线属于等待汇合，将移除整组汇合连线。' : action.edge.from + ' → ' + action.edge.to}</p>
        <p className="editor-hint">仅修改结构草稿，稍后统一查看并确认，不调用 Harness。</p>
        {reviewError && <p role="alert" className="editor-error">{reviewError}</p>}
        <div className="dialog-actions"><button onClick={() => setAction(null)}>取消</button><button className="primary" onClick={() => {
          if (!editor.target) return;
          try { commitDraft(action.kind === 'delete-node' ? removeDraftNode(editor.target, action.node.id) : removeDraftEdge(editor.target, action.edge)); setAction(null); }
          catch (e) { setReviewError((e as Error).message); }
        }}>从草稿移除</button></div>
      </div>}
      {action?.kind === 'discard' && <div className="review-draft"><h2>放弃本地草稿</h2><p>将清除当前图的本地结构修改并恢复源码图。{editor.draft?.receipt ? '清除本地记录不会取消已经接收的 Harness 请求。' : 'Python 源码未改动。'}</p>
        <div className="dialog-actions"><button onClick={() => setAction(null)}>继续保留</button><button onClick={() => { editor.clear(); setNode(null); setEdge(null); setAction(null); setEditMode(false); }}>放弃草稿并返回源码图</button></div>
      </div>}
    </EditorDialog>
  </div>;
}
