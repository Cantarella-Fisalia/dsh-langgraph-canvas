export const MINIMUM_PYTHON: '3.11';
export function resolvePythonCommand(command?: string, options?: {
  env?: { VIS4AGENT_PYTHON?: string }; exists?: (path: string) => boolean;
}): string;
export function checkPythonVersion(info: unknown, command: string): { command: string; executable: string; version: string };
export function probePython(command?: string, options?: {
  signal?: AbortSignal; cwd?: string; timeoutMs?: number;
}): Promise<{ command: string; executable: string; version: string }>;
