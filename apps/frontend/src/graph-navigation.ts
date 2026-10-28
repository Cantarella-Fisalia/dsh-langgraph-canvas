import type { Layout } from '../../../packages/contracts/src/index.ts';

export interface GraphViewSnapshot {
  graphId: string; sourceRevision: string; layoutRevision: string;
  positions: Layout['positions']; dirty: boolean; viewport: { x: number; y: number; zoom: number };
  selectedNodeId?: string; selectedEdgeId?: string;
}
export interface CanvasHandle { capture(): GraphViewSnapshot }
export const MAX_GRAPH_HISTORY = 64;

/** Page-local navigation only: no model calls, storage writes, or inferred parent relationships. */
export class GraphNavigation {
  private trail: string[] = [];
  private views = new Map<string, GraphViewSnapshot>();
  readonly scope: string;
  constructor(scope: string) { this.scope = scope; }
  remember(view: GraphViewSnapshot) { this.views.set(view.graphId, structuredClone(view)); }
  view(graphId: string, sourceRevision: string): GraphViewSnapshot | undefined {
    const value = this.views.get(graphId);
    return value?.sourceRevision === sourceRevision ? structuredClone(value) : undefined;
  }
  open(from: string, target: string, allowed: string[]): string | undefined {
    if (from === target || !allowed.includes(from) || !allowed.includes(target)) return undefined;
    this.trail = [...this.trail, from].slice(-MAX_GRAPH_HISTORY);
    return target;
  }
  previous(current: string, allowed: string[]) {
    return this.trail.findLast(id => id !== current && allowed.includes(id));
  }
  back(current: string, allowed: string[]): string | undefined {
    while (this.trail.length) {
      const target = this.trail.pop()!;
      if (target !== current && allowed.includes(target)) return target;
    }
    return undefined;
  }
  choose(current: string, target: string, allowed: string[]): string | undefined {
    if (current === target || !allowed.includes(target)) return undefined;
    this.trail = []; return target;
  }
  hasUnsaved(exceptGraphId?: string) { return [...this.views.values()].some(view => view.graphId !== exceptGraphId && view.dirty); }
}
