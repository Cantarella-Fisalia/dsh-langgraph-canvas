export interface SourceTransaction {
  id: string; requestId: string; graphId: string; baseRevision: string; generatedRevision: string; reviewHash: string;
  status: 'prepared' | 'applying' | 'applied' | 'undoing' | 'undone' | 'rolled_back' | 'recovery_required';
  createdAt: string; updatedAt: string; files: string[]; message: string;
  kind?: 'structure' | 'behavior'; originRequestId?: string; behaviorTaskId?: string;
}
export interface ConfirmSourceOperation {
  schemaVersion: 1; confirmed: true; reviewHash: string; acknowledgedWarnings?: boolean;
}
/** A generation snapshot; transaction.status reports whether it has been applied. */
export interface SourcePreview {
  schemaVersion: 1;
  requestId: string;
  graphId: string;
  baseRevision: string;
  generatedRevision: string;
  verified: true;
  originalModified: false;
  files: { file: string; before: string; after: string; baseHash: string; generatedHash: string; encoding: string; diff?: string; undoDiff?: string }[];
  warnings: string[];
  placeholders: string[];
  behaviorRequirements: { nodeId: string; functionRef: string; description: string }[];
  transaction?: SourceTransaction;
}
