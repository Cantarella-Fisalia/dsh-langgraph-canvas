import { compatibleStorage } from './legacy-storage.ts';
import type { Project, ProjectAnalysis, Layout } from '../../../packages/contracts/src/index.ts';
import { validateAnalysis } from '../../../packages/contracts/src/validation.ts';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface WorkspaceView {
  project: Project; analysis: ProjectAnalysis; graphId: string; references: boolean;
  layouts: Record<string, { revision: string; value: Layout }>;
}
const PREFIX = 'langcontour:workspace-view:v1:';
const MAX_ENTRY = 1_500_000, MAX_TOTAL = 2_000_000, MAX_AGE = 24 * 60 * 60 * 1000;
export function workspaceStorage(): StorageLike | undefined { try { return window.sessionStorage; } catch { return undefined; } }
export function validLayout(value: any): value is Layout {
  return value?.schemaVersion === 1 && typeof value.revision === 'string' && !!value.positions && typeof value.positions === 'object'
    && !Array.isArray(value.positions) && Object.values(value.positions).every((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
}
/** Disposable display snapshots; never a source-of-truth for edits or model requests. */
export function createWorkspaceCache(apiBase: string, storage?: StorageLike, clock = Date.now) {
  storage = compatibleStorage(storage);
  const memory = new Map<string, { savedAt: number; data: WorkspaceView }>();
  const indexKey = PREFIX + 'index:' + apiBase;
  const keyFor = (root: string) => PREFIX + JSON.stringify([apiBase, root.trim().replaceAll('\\', '/').replace(/\/$/, '')]);
  function read(root: string): WorkspaceView | null {
    const key = keyFor(root);
    try {
      const existing = memory.get(key);
      const text = existing ? null : storage?.getItem(key);
      const record = existing || (text && text.length <= MAX_ENTRY ? JSON.parse(text) : null);
      if (!record || !Number.isFinite(record.savedAt) || clock() - record.savedAt > MAX_AGE || record.savedAt > clock() + 60_000) return null;
      const data = record.data as WorkspaceView;
      if (!data?.project || typeof data.project.id !== 'string' || typeof data.project.name !== 'string' || typeof data.project.root !== 'string'
        || typeof data.graphId !== 'string' || typeof data.references !== 'boolean' || !data.layouts || typeof data.layouts !== 'object') return null;
      validateAnalysis(data.analysis);
      if (data.analysis.architecture && (!Array.isArray(data.analysis.architecture.graphs) || !Array.isArray(data.analysis.architecture.relationships))) return null;
      for (const item of Object.values(data.layouts)) if (!item || typeof item.revision !== 'string' || !validLayout(item.value)) return null;
      memory.set(key, record); return structuredClone(data);
    } catch { return null; }
  }
  function write(root: string, data: WorkspaceView) {
    const key = keyFor(root), record = { savedAt: clock(), data: structuredClone(data) };
    const text = JSON.stringify(record); if (text.length > MAX_ENTRY) return;
    memory.delete(key); memory.set(key, record);
    while (memory.size > 3) memory.delete(memory.keys().next().value!);
    try {
      let index: { key: string; size: number }[] = JSON.parse(storage?.getItem(indexKey) || '[]');
      if (!Array.isArray(index)) index = [];
      index = index.filter(entry => typeof entry.key === 'string' && entry.key.startsWith(PREFIX) && Number.isFinite(entry.size) && entry.key !== key);
      while (index.length >= 3 || index.reduce((n, entry) => n + entry.size, text.length) > MAX_TOTAL) {
        const old = index.shift(); if (!old) break; storage?.removeItem(old.key);
      }
      storage?.setItem(key, text); index.push({ key, size: text.length }); storage?.setItem(indexKey, JSON.stringify(index));
    } catch { /* Read-only memory fallback; caching never prevents opening a project. */ }
  }
  return { read, write };
}
