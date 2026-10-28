import type { GraphDocument, SourceLocation } from './index.ts';
export interface AnalysisFile {
  file: string; hash: string; lines: number; score: number;
  imports: string[]; symbols: { name: string; line: number; endLine: number; kind: string }[];
}
export interface AnalysisContext {
  revision: string; files: AnalysisFile[]; staticGraphs: GraphDocument[]; limitReached: boolean;
}
export interface AnalysisSource extends SourceLocation { text: string; hash: string }
export interface SessionContext { sessionId: string; projectRoot?: string }
export interface HarnessAnalysisAdapter {
  support(session?: SessionContext): { available: boolean; message: string } | Promise<{ available: boolean; message: string }>;
  analyze(context: AnalysisContext, options: {
    signal: AbortSignal;
    session?: SessionContext;
    readSource(request: SourceLocation): Promise<AnalysisSource>;
    progress(message: string): void;
  }): Promise<unknown>;
}
export interface AnalysisTask {
  id: string; revision: string; status: 'queued' | 'reading' | 'analyzing' | 'ready' | 'cancelled' | 'failed' | 'stale';
  message: string; createdAt: string; updatedAt: string; filesRead: number; graphCount?: number;
  sessionId?: string;
  requestId?: string;
}
export interface AnalysisTaskSnapshot {
  runtimeId: string;
  task: AnalysisTask | null;
  blockedByOtherSession: boolean;
}
