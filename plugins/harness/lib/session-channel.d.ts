import type { SessionContext } from '../../../packages/contracts/src/analysis.ts';
export function createSessionChannel(ctx: unknown): {
  support(session?: SessionContext): Promise<{ available: boolean; busy?: boolean; message: string }>;
  request(session: SessionContext, request: { text: string; signal: AbortSignal; requestId?: string; maxBytes?: number;
    onRoute?: (route: { provider: string; model: string }) => void }): Promise<{ text: string; sessionId: string; provider?: string; model?: string }>;
};
