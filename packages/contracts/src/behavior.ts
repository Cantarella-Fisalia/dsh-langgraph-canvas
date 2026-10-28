import type { GraphDocument } from './index.ts';
import type { SessionContext } from './analysis.ts';

export type BehaviorStatus = 'submitting' | 'queued' | 'running' | 'cancelling' | 'cancelled' | 'needs_attention'
  | 'review_ready' | 'failed' | 'conflicted';
export interface BehaviorRequirement {
  nodeId: string; functionRef: string; description: string; kind: 'node' | 'route';
  file: string; symbol: string; affectedNodes: string[]; branchValues?: (string | number | boolean)[];
}
export interface BehaviorTask {
  schemaVersion: 1; id: string; requestId: string; transactionId: string; graphId: string; baseRevision: string;
  status: BehaviorStatus; createdAt: string; updatedAt: string; message: string;
  hostTaskId?: string; resultTransactionId?: string; requirements: BehaviorRequirement[];
  cancelRequested?: boolean;
}
export interface BehaviorAssignment {
  session?: SessionContext;
  schemaVersion: 1; taskId: string; idempotencyKey: string; workingDirectory: string;
  allowedFiles: string[]; requirements: BehaviorRequirement[]; graph: GraphDocument; instruction: string;
  originalProjectWriteAllowed: false; executeProjectAllowed: false;
}
export interface BehaviorHandle { taskId: string; idempotencyKey: string; hostTaskId?: string }
export interface HarnessBehaviorAdapter {
  /** Optional session readiness. available permits monitoring; canSubmit=false means the session is busy. */
  support?(session?: SessionContext): BehaviorSupport | Promise<BehaviorSupport>;
  /** Must durably deduplicate by idempotencyKey and bind all writes to workingDirectory. */
  submit(assignment: BehaviorAssignment, options: { signal: AbortSignal }): Promise<{ hostTaskId: string }>;
  /** Without hostTaskId, look up the idempotency key; never start a new task here. */
  getStatus(handle: BehaviorHandle, options: { signal: AbortSignal }): Promise<{
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'; hostTaskId?: string; message?: string;
  }>;
  /** acknowledged=true guarantees the host stopped writing and no late start can occur. */
  cancel(handle: BehaviorHandle, options: { signal: AbortSignal }): Promise<{ acknowledged: boolean; message?: string }>;
}
export interface BehaviorSupport { available: boolean; canSubmit?: boolean; mode: 'workspace-task'; message: string }
export interface ConfirmBehaviorRequest {
  schemaVersion: 1; requestId: string; transactionId: string; reviewHash: string; confirmed: true;
  sessionId?: string;
}
