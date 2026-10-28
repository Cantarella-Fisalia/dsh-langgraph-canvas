import { compatibleStorage } from './legacy-storage.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { GraphDocument } from '../../../packages/contracts/src/index.ts';
import { draftChanges, editableGraph, identifier, normalizeEditableGraph, validateEditableGraph } from '../../../packages/contracts/src/editing.ts';
import type { EditableEdge, EditableGraph, EditableNode, EditReceipt, StructureDraft } from '../../../packages/contracts/src/editing.ts';

export type EditorAction = { kind: 'node'; node?: EditableNode } | { kind: 'edge'; edge?: EditableEdge; source?: string; target?: string }
  | { kind: 'state' } | { kind: 'delete-node'; node: EditableNode } | { kind: 'delete-edge'; edge: EditableEdge } | { kind: 'review' } | { kind: 'discard' }
  | { kind: 'history'; transactionId?: string } | { kind: 'tasks'; taskId?: string };
const freshId = () => crypto.randomUUID();
const boundary = (id: string) => id === '__start__' || id === '__end__';
function readDraft(key: string, graph: GraphDocument | null): { value: StructureDraft | null; error: string } {
  if (!key || !graph) return { value: null, error: '' };
  try {
    const text = compatibleStorage(localStorage)?.getItem(key);
    if (!text) return { value: null, error: '' };
    const draft = JSON.parse(text) as StructureDraft;
    if (draft.schemaVersion !== 1 || draft.graphId !== graph.id || typeof draft.projectId !== 'string' ||
        key !== 'langcontour:structure-draft:' + draft.projectId + ':' + draft.graphId ||
        typeof draft.baseRevision !== 'string' || typeof draft.requestId !== 'string' || !draft.original?.state ||
        !Array.isArray(draft.original.nodes) || draft.original.nodes.some(n => !n || typeof n.id !== 'string') ||
        typeof draft.original.state.reference !== 'string') throw new Error();
    const snapshot: GraphDocument = { ...graph, state: draft.original.state, nodes: draft.original.nodes.map(n => ({
      id: n.id, title: n.id, kind: boundary(n.id) ? 'boundary' : 'unknown', summary: n.description, functionRef: n.functionRef,
    })) };
    if (validateEditableGraph(draft.original, snapshot, false).length || validateEditableGraph(draft.target, snapshot, false).length) throw new Error();
    if (draft.receipt && (draft.receipt.status !== 'accepted' || draft.receipt.requestId !== draft.requestId || typeof draft.receipt.taskId !== 'string')) throw new Error();
    return { value: draft, error: '' };
  } catch { return { value: null, error: '已有本地草稿无法读取，原记录未覆盖；可重新编辑建立草稿。' }; }
}
export function useStructureDraft(projectId: string | undefined, base: GraphDocument | null) {
  const key = projectId && base ? 'langcontour:structure-draft:' + projectId + ':' + base.id : '';
  const recovered = useMemo(() => readDraft(key, base), [key]);
  const [session, setSession] = useState({ key, ...recovered });
  const active = session.key === key ? session : { key, ...recovered };
  const draft = active.value;
  const stale = !!draft && !!base && draft.baseRevision !== base.revision;
  const original = useMemo(() => draft?.original || (base ? editableGraph(base) : null), [base, draft?.original]);
  const target = draft?.target || original;
  const changes = useMemo(() => original && target ? draftChanges(original, target) : [], [original, target]);
  useEffect(() => { if (session.key !== key) setSession({ key, ...recovered }); }, [key, recovered, session.key]);
  function persist(value: StructureDraft | null) {
    let error = '';
    try { if (key) value ? compatibleStorage(localStorage)?.setItem(key, JSON.stringify(value)) : compatibleStorage(localStorage)?.removeItem(key); }
    catch { error = '浏览器未允许保存本地草稿；当前修改只保留在本页，关闭前请勿丢弃。'; }
    setSession({ key, value, error });
  }
  function change(next: EditableGraph) {
    if (!base || !projectId || !original) return;
    if (stale || draft?.receipt) throw new Error(stale ? '源码版本已变化，请核对并放弃旧草稿后重新编辑。' : '此草稿已提交；本页不能修改已提交的请求。');
    const issues = validateEditableGraph(next, base, false);
    if (issues.length) throw new Error(issues.join('\n'));
    const target = normalizeEditableGraph(next);
    persist(draftChanges(original, target).length ? {
      schemaVersion: 1, projectId, graphId: base.id, baseRevision: base.revision,
      requestId: freshId(), original, target,
    } : null);
  }
  function accept(receipt: EditReceipt) {
    if (draft) persist({ ...draft, receipt });
  }
  return { draft, target, changes, stale, storageError: active.error, change, accept, clear: () => persist(null),
    issues: base && target ? validateEditableGraph(target, base, true) : [] };
}

function LocalForm({ title, children, onSave, onClose }: {
  title: string; children: React.ReactNode; onSave: () => void; onClose: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onSave(); } catch (e) { setError((e as Error).message); }
  }
  return <form className="structure-form" onSubmit={submit}>
    <h2>{title}</h2><p className="editor-hint">仅保存到本地结构草稿；此操作不调用 Harness，也不修改 Python。</p>
    {children}{error && <p role="alert" className="editor-error">{error}</p>}
    <div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary">保存到草稿</button></div>
  </form>;
}
function NodeForm({ node, target, save, close }: { node?: EditableNode; target: EditableGraph; save: (graph: EditableGraph) => void; close: () => void }) {
  const [id, setId] = useState(node?.id || '');
  const [functionRef, setFunction] = useState(node?.functionRef || '');
  const [description, setDescription] = useState(node?.description || '');
  return <LocalForm title={node ? '编辑节点' : '新增节点'} onClose={close} onSave={() => {
    const value: EditableNode = { id: id.trim(), functionRef: functionRef.trim() || undefined, description: description.trim() };
    save({ ...target, nodes: node ? target.nodes.map(n => n.id === node.id ? value : n) : [...target.nodes, value],
      edges: node ? target.edges.map(e => ({ ...e, from: e.from === node.id ? value.id : e.from, to: e.to === node.id ? value.id : e.to })) : target.edges });
  }}>
    <label>节点名称（注册 ID）<input autoFocus required maxLength={128} value={id} onChange={e => {
      const previous = id; setId(e.target.value);
      if (!node && (!functionRef || functionRef === previous)) setFunction(identifier(e.target.value) ? e.target.value : functionRef);
    }} placeholder="例如 reviewer" /></label>
    <label>实现函数<input required={!node} maxLength={512} value={functionRef} onChange={e => setFunction(e.target.value)} placeholder="例如 review 或 nodes.review" /></label>
    <label>节点职责／实现要求<textarea rows={4} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="说明这个节点读取什么、处理什么、返回什么更新" /></label>
    <p className="editor-hint">新节点名称支持文字、数字、下划线与短横线。改名会同步草稿中的入边和出边。</p>
  </LocalForm>;
}
function EdgeForm({ action, target, save, close }: { action: Extract<EditorAction, { kind: 'edge' }>; target: EditableGraph; save: (graph: EditableGraph) => void; close: () => void }) {
  const edge = action.edge;
  const members = edge?.kind === 'join' ? target.edges.filter(e => e.kind === 'join' && e.joinId === edge.joinId) : edge ? [edge] : [];
  const [kind, setKind] = useState<EditableEdge['kind']>(edge?.kind || 'normal');
  const [source, setSource] = useState(edge?.from || action.source || '__start__');
  const [destination, setDestination] = useState(edge?.to || action.target || '__end__');
  const [sources, setSources] = useState(members.map(e => e.from));
  const [route, setRoute] = useState(edge?.route || '');
  const [label, setLabel] = useState(edge?.label || '');
  const starts = target.nodes.filter(n => n.id !== '__end__');
  const ends = target.nodes.filter(n => n.id !== '__start__');
  return <LocalForm title={edge ? '编辑连线' : '新增连线'} onClose={close} onSave={() => {
    if (kind === 'join' && sources.length < 2) throw new Error('等待汇合需要至少两个不同的前置节点。');
    const oldIds = new Set(members.map(e => e.id));
    const remaining = target.edges.filter(e => !oldIds.has(e.id));
    const joinId = edge?.kind === 'join' ? edge.joinId : 'draft-join-' + freshId();
    const additions: EditableEdge[] = kind === 'join'
      ? sources.map(from => ({ id: members.find(e => e.from === from)?.id || 'draft-edge-' + freshId(), from, to: destination, kind, joinId }))
      : [{ id: edge?.kind !== 'join' && edge ? edge.id : 'draft-edge-' + freshId(), from: source, to: destination, kind,
        ...(kind === 'conditional' ? { label, route: route.trim() } : {}) }];
    save({ ...target, edges: [...remaining, ...additions] });
  }}>
    <label>连线类型<select value={kind} onChange={e => setKind(e.target.value as EditableEdge['kind'])}>
      <option value="normal">普通流转（多条普通出边会并行分发）</option><option value="conditional">条件分支</option><option value="join">等待全部前置节点汇合</option>
    </select></label>
    {kind === 'join' ? <fieldset><legend>全部前置节点（至少两个）</legend>{starts.map(n => <label className="checkbox-row" key={n.id}>
      <input type="checkbox" checked={sources.includes(n.id)} onChange={e => setSources(e.target.checked ? [...sources, n.id] : sources.filter(id => id !== n.id))} />{n.id}</label>)}</fieldset>
      : <label>起点<select value={source} onChange={e => setSource(e.target.value)}>{starts.map(n => <option key={n.id}>{n.id}</option>)}</select></label>}
    <label>终点<select value={destination} onChange={e => setDestination(e.target.value)}>{ends.map(n => <option key={n.id}>{n.id}</option>)}</select></label>
    {kind === 'conditional' && <><label>路由函数<input required value={route} maxLength={512} onChange={e => setRoute(e.target.value)} placeholder="例如 route_review" /></label>
      <label>分支值（路由返回值）<input value={label} maxLength={512} onChange={e => setLabel(e.target.value)} placeholder="例如 revise" /></label>
      <p className="editor-hint">本批按文本值记录路由条件；具体 Python 字面量类型在后续源码生成时校验。</p></>}
    <p className="editor-hint">等待汇合按整组编辑；普通多入边不表示等待所有来源完成。</p>
  </LocalForm>;
}
function StateForm({ target, save, close }: { target: EditableGraph; save: (graph: EditableGraph) => void; close: () => void }) {
  const [fields, setFields] = useState(target.state.fields.map(f => ({ ...f, key: freshId() })));
  return <LocalForm title="编辑共享 State 字段" onClose={close} onSave={() => save({ ...target, state: { ...target.state,
    fields: fields.map(f => ({ name: f.name.trim(), annotation: f.annotation.trim() })) } })}>
    <p className="state-reference">State 定义：<code>{target.state.reference || '未识别'}</code></p>
    <div className="state-edit-fields">{fields.map((field, index) => <div className="state-edit-row" key={field.key}>
      <label>字段名称 {index + 1}<input required maxLength={128} value={field.name} onChange={e => setFields(fields.map(f => f.key === field.key ? { ...f, name: e.target.value } : f))} /></label>
      <label>类型注解 {index + 1}<input required maxLength={1000} value={field.annotation} onChange={e => setFields(fields.map(f => f.key === field.key ? { ...f, annotation: e.target.value } : f))} placeholder="例如 str、list[str]" /></label>
      <button type="button" aria-label={'移除字段 ' + (field.name || index + 1)} onClick={() => setFields(fields.filter(f => f.key !== field.key))}>移除</button>
    </div>)}</div>
    <button type="button" onClick={() => setFields([...fields, { key: freshId(), name: '', annotation: 'str' }])}>＋ 添加字段</button>
    <p className="editor-hint">当前记录静态定义；字段删改涉及的节点代码、类型与 reducer 会在后续源码修改阶段检查。</p>
  </LocalForm>;
}
export function EditorDialog({ action, target, onSave, onClose, children }: {
  action: EditorAction | null; target: EditableGraph | null; onSave: (graph: EditableGraph) => void; onClose: () => void; children?: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!action) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => previous?.focus();
  }, [action?.kind]);
  if (!action || (!target && action.kind !== 'history' && action.kind !== 'tasks')) return null;
  const save = (graph: EditableGraph) => { onSave(graph); onClose(); };
  return <div className="editor-dialog-backdrop"><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={action.kind === 'review' ? '确认结构修改' : action.kind === 'history' ? '源码变更记录' : action.kind === 'tasks' ? '行为任务' : '编辑 LangGraph 草稿'} className="editor-dialog" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || []);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <button className="dialog-close" aria-label="关闭草稿窗口" onClick={onClose}>×</button>
    {action.kind === 'node' ? <NodeForm node={action.node} target={target!} save={save} close={onClose} />
      : action.kind === 'edge' ? <EdgeForm action={action} target={target!} save={save} close={onClose} />
      : action.kind === 'state' ? <StateForm target={target!} save={save} close={onClose} />
      : children}
  </section></div>;
}
