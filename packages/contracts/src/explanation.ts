import type { SourceLocation } from './index.ts';

/** Source locations are checked; the meaning remains an AI interpretation. */
export interface ExplainedText { text: string; evidence: SourceLocation[] }
export interface NodeExplanation {
  nodeId: string; execution: 'function' | 'callable' | 'subgraph' | 'unknown';
  displayName?: ExplainedText;
  summary: ExplainedText; reads: string[]; writes: string[];
  calls: { name: string; source: SourceLocation }[];
}
export interface GraphExplanation {
  graphId: string; purpose: ExplainedText; entry: ExplainedText; exit: ExplainedText;
  stateFields: { name: string; role: 'input' | 'intermediate' | 'output' | 'mixed' | 'unknown'; meaning: ExplainedText; readers: string[]; writers: string[] }[];
  nodes: NodeExplanation[];
  conditions: { edgeId: string; when: ExplainedText }[];
}
export interface ArchitectureExplanation {
  schemaVersion: 1; revision: string; overview: ExplainedText;
  graphs: GraphExplanation[];
  relationships: { fromGraphId: string; toGraphId: string;
    kind: 'registered_subgraph' | 'indirect_call' | 'shared_state' | 'possible';
    viaNodeId?: string; explanation: ExplainedText; callPath: { name: string; source: SourceLocation }[] }[];
  unresolved: string[];
}
