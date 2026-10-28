import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, Panel,
  useReactFlow, BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { Node, NodeProps, Edge, EdgeProps, NodeChange } from '@xyflow/react';
import type { EditorNode, EditorEdge, EditorGraph } from '../../../packages/contracts/src/editing.ts';
import type { Layout, SourceLocation, ProjectAnalysis, GraphDocument } from '../../../packages/contracts/src/index.ts';
import type { GraphExplanation, NodeExplanation } from '../../../packages/contracts/src/explanation.ts';
import type { ApiClient } from '../../../packages/api-client/src/index.ts';
import type { ViewMode } from './view-mode.ts';
import { nodeDisplayName, nodeExecution } from './explanation-view.ts';
import { CanvasState } from './canvas-state.tsx';
import { FunctionTable } from './function-table.tsx';
import { buildFlowchart, flowchartPositions, decisionPosition, graphCalls, edgeLabel } from './flowchart.ts';
import type { Decision, GraphCall } from './flowchart.ts';
import type { CanvasHandle, GraphViewSnapshot } from './graph-navigation.ts';
import type { Ref } from 'react';

type AgentNode = Node<{ item: EditorNode; editable: boolean; explanation?: NodeExplanation; displayName: string;
  viewMode: ViewMode; boundaryText?: string; calls: GraphCall[]; size: { width: number; height: number }; onOpenGraph: (id: string) => void }, 'agent'>;
type DecisionNode = Node<{ decision: Decision; viewMode: ViewMode }, 'decision'>;
type CanvasNode = AgentNode | DecisionNode;
type FlowEdge = Edge<{ item?: EditorEdge; decision?: Decision; onSelect: (edge: EditorEdge) => void;
  conditionText?: string; fromName: string; toName: string }, 'structure'>;

function NodePorts({ editable, start = false, end = false }: { editable: boolean; start?: boolean; end?: boolean }) {
  return <>
    <Handle id="left" type="target" position={Position.Left} isConnectable={editable && !start} />
    <Handle id="right" type="source" position={Position.Right} isConnectable={editable && !end} />
    <Handle id="top-in" type="target" position={Position.Top} isConnectable={editable && !start} />
    <Handle id="down-out" type="source" position={Position.Bottom} isConnectable={editable && !end} />
    <Handle id="loop-in" type="target" position={Position.Left} style={{ top: '28%' }} isConnectable={editable && !start} />
    <Handle id="loop-out" type="source" position={Position.Right} style={{ top: '72%' }} isConnectable={editable && !end} />
  </>;
}
function GraphCard({ data, selected }: NodeProps<AgentNode>) {
  const boundary = data.item.kind === 'boundary';
  const execution = nodeExecution(data.item, data.explanation);
  const callsGraph = !boundary && !data.item.pending && (data.calls.length > 0 || execution.execution === 'subgraph');
  return <div className={'graph-card ' + (boundary ? 'boundary ' : '') + (callsGraph ? 'graph-call ' : '') + (selected ? 'selected' : '')} style={data.size}>
    <NodePorts editable={data.editable} start={data.item.id === '__start__'} end={data.item.id === '__end__'} />
    <div className="node-top"><span className="node-icon">{boundary ? (data.item.id === '__start__' ? '↗' : '✓') : callsGraph ? '▥' : '□'}</span>
      <span className="node-type">{boundary ? '流程边界' : data.item.pending ? '草稿节点' : execution.label}{!boundary && data.viewMode === 'professional' ? ' · 源码原名' : data.explanation && ' · AI 解读'}</span>
      {data.item.pending && <span className="draft-tag">未应用</span>}
    </div>
    <strong title={data.viewMode === 'professional' ? data.displayName : data.item.id}>{data.displayName}</strong>
    {boundary && <p className="node-summary" title={data.boundaryText}>{data.boundaryText}</p>}
    {!boundary && <>{data.viewMode === 'professional' ? <><small title={data.item.id}>注册 ID · {data.item.id}</small>
      {(data.item.implementation || data.item.registration) && <small>{(data.item.implementation || data.item.registration)!.file}:{(data.item.implementation || data.item.registration)!.line}</small>}</>
      : !data.explanation?.displayName && <small>待 AI 命名 · 点击右上角 AI</small>}
      <p className="node-summary" title={data.explanation?.summary.text || data.item.summary}>{data.explanation?.summary.text || data.item.summary || '未提供职责说明，点击查看源码'}</p></>}
    {callsGraph && <div className="graph-call-links nodrag nopan">
      {data.calls.map(call => <button key={call.target.id + call.relationship.kind} title={call.relationship.explanation.text}
        aria-label={'展开子图 ' + call.target.title} onClick={event => { event.stopPropagation(); data.onOpenGraph(call.target.id); }}>
        <span>{call.relationship.kind === 'registered_subgraph' ? '子图' : '内部调用图'} · AI 依据</span><b>展开子图 · {call.target.title} →</b>
      </button>)}
      {!data.calls.length && <button disabled title="目标图尚未确认；可明确点击 AI 重新解读。">展开子图 · 目标待确认</button>}
    </div>}
  </div>;
}
function DecisionCard({ data }: NodeProps<DecisionNode>) {
  return <div className="decision-node" title={`条件路由：${data.decision.route || '未识别'}。仅展示已有条件边；点击查看分支与源码。`}>
    <NodePorts editable={false} />
    <svg className="decision-outline" viewBox="0 0 184 144" aria-hidden="true"><polygon points="92,2 182,72 92,142 2,72" /></svg>
    <div className="decision-caption"><strong>{data.viewMode === 'professional' ? data.decision.route || '未识别路由' : '条件分流'}</strong>
      <small>{data.decision.edges.length} 条分支</small><small>路由判断 · 仅展示</small></div>
  </div>;
}
const nodeTypes = { agent: GraphCard, decision: DecisionCard };
function StructureEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data, label, selected }: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 });
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
    {data?.item && <EdgeLabelRenderer><button className={'edge-label nodrag nopan ' + data.item.kind + (selected ? ' selected' : '') + (data.item.pending ? ' pending' : '')}
      style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
      aria-label={data.fromName + ' → ' + data.toName + '，' + label} title={data.fromName + ' → ' + data.toName + '，' + (data.conditionText || label)}
      onClick={event => { event.stopPropagation(); data.onSelect(data.item!); }}>{label}</button></EdgeLabelRenderer>}
  </>;
}
const edgeTypes = { structure: StructureEdge };

export function Canvas({ graph, analysis, visibleGraphs, explanation, viewMode, onOpenGraph, onSource, layout, onLayoutSaved, api, projectId,
  captureRef, initialView, onSelect, selectedNodeId, onEdgeSelect, selectedEdgeId, onDirty, onMessage, colorScheme, verified, editable, hasDraft, layoutNodeIds, onCreateConnection }: {
  graph: EditorGraph; analysis: ProjectAnalysis | null; visibleGraphs: GraphDocument[]; layout: Layout; api: ApiClient; projectId: string; onOpenGraph: (id: string) => void;
  captureRef: Ref<CanvasHandle>; initialView?: GraphViewSnapshot;
  onLayoutSaved: (layout: Layout) => void; viewMode: ViewMode; explanation?: GraphExplanation; onSource: (source: SourceLocation) => void;
  onSelect: (node: EditorNode | null) => void; onDirty: (dirty: boolean) => void; onMessage: (message: string) => void;
  onEdgeSelect: (edge: EditorEdge) => void; selectedEdgeId?: string; selectedNodeId?: string; colorScheme: 'light' | 'dark';
  verified: boolean; editable: boolean; hasDraft: boolean; layoutNodeIds: string[]; onCreateConnection: (source: string, target: string) => void;
}) {
  const restored = useRef(initialView?.sourceRevision === graph.revision ? initialView : undefined).current;
  const chart = useMemo(() => buildFlowchart(graph), [graph]);
  const defaults = useMemo(() => flowchartPositions(chart), [chart]);
  const calls = useMemo(() => graphCalls(analysis, graph, visibleGraphs), [analysis, graph, visibleGraphs]);
  const [positions, setPositions] = useState<Layout['positions']>(() => Object.fromEntries(graph.nodes.map(n => [n.id, restored?.positions[n.id] || layout.positions[n.id] || defaults[n.id]])));
  const [dirty, setDirty] = useState(restored?.dirty || false), [saving, setSaving] = useState(false), [revision, setRevision] = useState(restored?.layoutRevision || layout.revision);
  const flow = useReactFlow(), dirtyRef = useRef(dirty), positionsRef = useRef(positions), revisionRef = useRef(revision);
  positionsRef.current = positions; revisionRef.current = revision;
  useImperativeHandle(captureRef, () => ({ capture: () => ({ graphId: graph.id, sourceRevision: graph.revision, layoutRevision: revisionRef.current,
    positions: structuredClone(positionsRef.current), dirty: dirtyRef.current, viewport: flow.getViewport(), selectedNodeId, selectedEdgeId }) }), [graph.id, graph.revision, flow, selectedNodeId, selectedEdgeId]);
  useEffect(() => {
    setPositions(previous => Object.fromEntries(graph.nodes.map(n => [n.id, previous[n.id] || layout.positions[n.id] || defaults[n.id]])));
  }, [graph, defaults, layout.positions]);
  useEffect(() => {
    if (!dirtyRef.current && layout.revision !== revision) {
      setRevision(layout.revision); revisionRef.current = layout.revision;
      setPositions(Object.fromEntries(graph.nodes.map(n => [n.id, layout.positions[n.id] || defaults[n.id]])));
    }
  }, [layout.revision, layout.positions, defaults, revision, graph]);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); onDirty(value); }, [onDirty]);
  useEffect(() => { onDirty(dirtyRef.current); return () => onDirty(false); }, [onDirty]);
  const chartPositions = { ...defaults, ...positions };
  for (const decision of chart.decisions) chartPositions[decision.id] = decisionPosition(decision, chartPositions, defaults);
  const nodes: CanvasNode[] = chart.nodes.map(spec => {
    const size = spec.decision ? { width: 184, height: 144 } : spec.item?.kind === 'boundary' ? { width: 200, height: 112 }
      : { width: 240, height: calls.has(spec.id) || spec.item?.execution === 'subgraph' ? 240 : 200 };
    const common = { id: spec.id, position: chartPositions[spec.id], width: size.width, height: size.height, measured: size, style: size,
      draggable: !!spec.item && !saving, connectable: editable, zIndex: 0 };
    if (spec.decision) return { ...common, type: 'decision', data: { decision: spec.decision, viewMode }, draggable: false, connectable: false,
      selected: spec.decision.edges.some(e => e.id === selectedEdgeId), ariaLabel: `条件分流 · ${spec.decision.route || '未识别路由'} · ${spec.decision.edges.length} 条分支` };
    const item = spec.item!;
    return { ...common, type: 'agent', selected: item.id === selectedNodeId, data: { item, size, editable,
      explanation: explanation?.nodes.find(n => n.nodeId === item.id), displayName: nodeDisplayName(graph, item.id, explanation, viewMode), viewMode,
      calls: calls.get(item.id) || [], onOpenGraph, boundaryText: item.id === '__start__' ? explanation?.entry.text || '接收输入，沿出边开始执行。'
        : item.id === '__end__' ? explanation?.exit.text || '本次执行结束，返回图的输出。' : undefined } };
  });
  const edges: FlowEdge[] = chart.edges.map(segment => {
    const edge = segment.item, condition = edge?.pending ? undefined : explanation?.conditions.find(c => c.edgeId === edge?.id)?.when.text;
    const backwards = chartPositions[segment.to].y <= chartPositions[segment.from].y;
    const selected = !!selectedEdgeId && (edge?.id === selectedEdgeId || !!segment.decision?.edges.some(e => e.id === selectedEdgeId));
    const conditional = edge?.kind === 'conditional' || !!segment.decision;
    const fullLabel = edge ? edgeLabel(edge, graph) : '路由判断';
    const name = (id: string) => nodeDisplayName(graph, id, explanation, viewMode);
    return { id: segment.id, source: segment.from, target: segment.to, zIndex: 1,
      sourceHandle: backwards ? 'loop-out' : 'down-out', targetHandle: backwards ? 'loop-in' : 'top-in',
      label: viewMode === 'standard' && condition ? '条件 · ' + (condition.length > 18 ? condition.slice(0, 18) + '…' : condition) : fullLabel,
      selected, ariaLabel: edge ? name(edge.from) + ' → ' + name(edge.to) + '，' + (condition || fullLabel) : '执行后进行路由判断',
      type: 'structure', animated: false, data: { item: edge, decision: segment.decision, onSelect: onEdgeSelect, conditionText: condition,
        fromName: edge ? name(edge.from) : name(segment.decision!.from), toName: edge ? name(edge.to) : '条件分流' },
      style: { stroke: selected ? 'var(--vf-accent)' : conditional ? 'var(--vf-warning)' : 'var(--vf-edge)',
        strokeWidth: edge?.kind === 'join' || selected ? 2.5 : 1.5, strokeDasharray: conditional ? '5 5' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: conditional ? 'var(--vf-warning)' : 'var(--vf-edge)' } };
  });
  function onNodesChange(changes: NodeChange<CanvasNode>[]) {
    const moved = changes.filter(change => change.type === 'position' && change.position && graph.nodes.some(n => n.id === change.id));
    if (moved.length) setPositions(previous => {
      const next = { ...previous };
      for (const change of moved) if (change.type === 'position' && change.position) next[change.id] = change.position;
      positionsRef.current = next; return next;
    });
  }
  async function save() {
    setSaving(true);
    try {
      const savedPositions = Object.fromEntries(Object.entries(positions).filter(([id]) => layoutNodeIds.includes(id)));
      const saved = await api.saveLayout(projectId, graph.id, graph.revision, { schemaVersion: 1, revision, positions: savedPositions });
      setRevision(saved.revision); revisionRef.current = saved.revision; markDirty(false); onLayoutSaved(saved); onMessage('布局已保存，Python 源码保持原样。');
    } catch (e) { onMessage('保存失败：' + (e as Error).message); }
    finally { setSaving(false); }
  }
  return <>
    <div className="canvas-actions"><div className="legend">
      <span><i className="step-symbol" />执行步骤</span><span><i className="decision-symbol" />条件分流</span><span><i className="call-symbol" />图调用</span><span><i className="join" />等待汇合</span>
    </div><button title="按执行顺序从上到下排列，展开分支；回环保留为返回连线。"
      onClick={() => { setPositions(Object.fromEntries(graph.nodes.map(n => [n.id, defaults[n.id]]))); markDirty(true); setTimeout(() => flow.fitView({ padding: 0.2 }), 30); }}>自动排布</button>
      <button className={dirty ? 'accent' : ''} disabled={!verified || saving || !dirty || hasDraft}
        title={hasDraft ? '结构草稿的节点尚未写回源码；先保留本地草稿，暂不保存源码图布局。' : undefined}
        onClick={save}>{hasDraft ? '草稿布局预览' : saving ? '保存中…' : dirty ? '保存布局 ·' : '布局已保存'}</button>
    </div>
    <ReactFlow<CanvasNode, FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
      onNodeDragStop={() => markDirty(true)} nodesDraggable={!saving} nodesConnectable={editable} elevateNodesOnSelect={false} elevateEdgesOnSelect={false}
      onConnect={connection => { if (editable && graph.nodes.some(n => n.id === connection.source) && graph.nodes.some(n => n.id === connection.target)) onCreateConnection(connection.source!, connection.target!); }}
      deleteKeyCode={null} onNodeClick={(_e, n) => n.type === 'decision' ? onEdgeSelect(n.data.decision.edges[0]) : onSelect(n.data.item)} onPaneClick={() => onSelect(null)}
      onEdgeClick={(_event, e) => { const item = e.data?.item || e.data?.decision?.edges[0]; if (item) onEdgeSelect(item); }}
      defaultViewport={restored?.viewport} fitView={!restored} fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.08} maxZoom={1.8} colorMode={colorScheme} proOptions={{ hideAttribution: false }}>
      <Panel position="top-left"><div className="canvas-reference-tools"><CanvasState graph={graph} viewMode={viewMode} explanation={explanation} onSource={onSource} /><FunctionTable graph={graph} viewMode={viewMode} explanation={explanation} onSelect={onSelect} /></div></Panel>
      <Background color="var(--vf-border)" gap={24} size={1} /><Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={n => n.type === 'decision' ? 'var(--vf-warning)' : 'var(--vf-accent)'} maskColor="var(--vf-minimap-mask)" />
    </ReactFlow>
    <div className="canvas-foot"><span>{editable ? '真实节点端口可创建连线草稿 · 菱形只展示已有路由' : '点击节点查看详情 · 点击“展开子图”跳转 · 顶部返回来源图'}</span><span>{hasDraft ? '结构草稿 · 尚未修改源码' : '源码图 · 可保存布局'}</span></div>
  </>;
}
