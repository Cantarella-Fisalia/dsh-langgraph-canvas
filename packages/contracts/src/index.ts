export const SCHEMA_VERSION = 1 as const;
import type { ArchitectureExplanation } from './explanation.ts';
export interface SourceLocation { file: string; line: number; endLine: number; column: number }
export interface Diagnostic {
  code: string; severity: 'info' | 'warning' | 'error'; message: string; source?: SourceLocation;
}
export interface GraphNode {
  id: string; title: string; kind: 'function' | 'unknown' | 'boundary';
  functionRef?: string; summary?: string; registration?: SourceLocation; implementation?: SourceLocation;
  execution?: 'function' | 'callable' | 'subgraph' | 'unknown';
}
export interface GraphEdge {
  id: string; from: string; to: string; kind: 'normal' | 'conditional' | 'join';
  label?: string; route?: string; joinId?: string; source: SourceLocation;
  routerSource?: SourceLocation;
}
export interface GraphDocument {
  schemaVersion: 1; id: string; title: string; file: string; symbol: string; scope: string; revision: string;
  state: { reference: string; source?: SourceLocation; fields: { name: string; annotation: string; source?: SourceLocation }[] };
  nodes: GraphNode[]; edges: GraphEdge[]; diagnostics: Diagnostic[];
  capabilities: { structuralEdit: false; sourceRead: true };
  discovery?: { method: 'static' | 'ai'; category: 'project' | 'reference'; completeness: 'static' | 'partial' | 'inferred';
    readOnly: boolean; reason?: string; evidenceStatus?: 'locations_checked' };
}
export interface ProjectAnalysis {
  schemaVersion: 1; graphs: GraphDocument[]; diagnostics: Diagnostic[]; revision: string; scannedFiles: number;
  scan?: { root: string; files: string[]; limitReached: boolean; projectGraphCount: number; referenceGraphCount: number };
  deepAnalysis?: { revision: string; graphCount: number; cached: boolean; message: string };
  architecture?: ArchitectureExplanation;
}
export interface Project { id: string; name: string; root: string }
export interface Layout {
  schemaVersion: 1; revision: string; positions: Record<string, { x: number; y: number }>;
}
export interface SourceDocument { file: string; content: string; revision: string }
export interface CapabilityDescriptor {
  id: string; kind: 'mcp' | 'rag' | 'tool' | 'skill'; scopes: ('development' | 'runtime')[];
  status: 'not_configured' | 'ready' | 'error'; title: string; description: string;
}
export interface ProjectEvent {
  schemaVersion: 1; id: string; sequence: number; projectId: string;
  type: 'project.changed' | 'layout.saved' | 'behavior.changed' | 'heartbeat'; revision?: string;
}
export interface ApiError { error: { code: string; message: string } }
