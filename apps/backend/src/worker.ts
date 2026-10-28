import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { probePython, resolvePythonCommand } from '../../../scripts/runtime/python.mjs';

export class PythonWorker {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private stderr = '';
  private command: string;
  private root: string;
  private startup?: Promise<ChildProcessWithoutNullStreams>;
  private startupController?: AbortController;
  private closed = false;
  constructor(root: string, command?: string) {
    this.root = root; this.command = resolvePythonCommand(command);
  }
  private async start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.closed) throw Object.assign(new Error('Python worker 已关闭。'), { status: 503, code: 'CLOSED' });
    if (this.child) return this.child;
    if (this.startup) return this.startup;
    const controller = new AbortController();
    this.startupController = controller;
    const starting = (async () => {
      const python = await probePython(this.command, { cwd: this.root, signal: controller.signal });
      if (this.closed) throw Object.assign(new Error('Python worker 已关闭。'), { status: 503, code: 'CLOSED' });
      return this.spawnWorker(python.executable);
    })();
    this.startup = starting;
    try { return await starting; }
    finally { if (this.startup === starting) { this.startup = undefined; this.startupController = undefined; } }
  }
  private spawnWorker(command: string) {
    const child = spawn(command, ['-u', '-m', 'vislang_worker'], {
      cwd: this.root, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPATH: [join(this.root, 'services/python-worker/src'), process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
    });
    this.child = child;
    this.stderr = '';
    const fail = (error: Error) => {
      if (this.child !== child) return;
      if (this.child === child) this.child = undefined;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const response = JSON.parse(line);
        const request = this.pending.get(response.id);
        if (!request) return;
        this.pending.delete(response.id); clearTimeout(request.timer);
        if (response.schemaVersion !== 1) request.reject(new Error('Worker protocol version mismatch'));
        else if (response.error) request.reject(Object.assign(new Error(response.error.message), {
          code: response.error.code, status: response.error.status,
        }));
        else request.resolve(response.result);
      } catch { fail(new Error('Python worker returned invalid protocol JSON')); child.kill(); }
    });
    child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    child.on('error', (error) => fail(new Error('Python 启动失败：' + error.message)));
    child.on('exit', () => fail(new Error('Python worker exited. ' + this.stderr)));
    return child;
  }
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = await this.start();
    if (this.closed) throw Object.assign(new Error('Python worker 已关闭。'), { status: 503, code: 'CLOSED' });
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { child.kill(); }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      child.stdin.write(JSON.stringify({ schemaVersion: 1, id, method, params }) + '\n', (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  close() {
    this.closed = true; this.startupController?.abort();
    const child = this.child; this.child = undefined;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker closed')); }
    this.pending.clear(); child?.kill();
  }
}
