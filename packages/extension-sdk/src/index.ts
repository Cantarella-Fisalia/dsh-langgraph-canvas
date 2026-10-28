import type { CapabilityDescriptor } from '../../contracts/src/index.ts';
export interface ExtensionManifest {
  id: string; version: string; kind: CapabilityDescriptor['kind'];
  scopes: CapabilityDescriptor['scopes']; configSchema: Record<string, unknown>; capabilities: string[];
}
export interface ExecutionContext {
  projectId: string; taskId: string; signal: AbortSignal; timeoutMs: number; credentialRefs: Record<string, string>;
}
export interface ToolDefinition {
  id: string; title: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  execute(input: unknown, context: ExecutionContext): Promise<unknown>;
}
export interface Retriever {
  retrieve(query: string, context: ExecutionContext): Promise<{ text: string; source: string; score?: number }[]>;
}
export interface SkillResource { id: string; version: string; instructions: string; resourceRefs: string[] }
export interface McpConnection {
  id: string;
  discover(context: ExecutionContext): Promise<{ tools: ToolDefinition[]; resources: string[]; prompts: string[] }>;
  close(): Promise<void>;
}
