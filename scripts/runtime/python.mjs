import { environmentValue } from './brand.mjs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

export const MINIMUM_PYTHON = '3.11';
export function resolvePythonCommand(command, { env = process.env, exists = existsSync } = {}) {
  return command?.trim() || environmentValue('PYTHON', env)
    || (exists('D:/Anaconda/python.exe') ? 'D:/Anaconda/python.exe' : 'python');
}
function failure(code, message) { return Object.assign(new Error(message), { code, status: 503 }); }
const guidance = '请将 DSH_LANGGRAPH_CANVAS_PYTHON 设置为 Python 3.11+ 解释器的路径，然后重新启动。';
export function checkPythonVersion(info, command) {
  if (!Array.isArray(info?.version) || info.version.length < 3 || !info.version.every(Number.isInteger)
    || typeof info.executable !== 'string' || !info.executable) {
    throw failure('PYTHON_INVALID_RESPONSE', `无法读取 Python 版本（${command}）。${guidance}`);
  }
  const [major, minor] = info.version;
  if (major < 3 || major === 3 && minor < 11) {
    throw failure('PYTHON_VERSION_UNSUPPORTED', `Python 版本不兼容：${info.executable} 为 ${info.version.join('.')}，需要 Python ${MINIMUM_PYTHON}+。${guidance}`);
  }
  return { command, executable: info.executable, version: info.version.join('.') };
}
export function probePython(command = resolvePythonCommand(), { signal, cwd, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('PYTHON_START_ABORTED', 'Python 启动检查已取消。')); return; }
    // Version inspection never imports project code, sitecustomize or user PYTHONPATH modules.
    const code = 'import sys,json; print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable}))';
    const child = spawn(command, ['-I', '-S', '-c', code], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (error) reject(error); else resolve(result);
    };
    const stop = () => { child.kill(); finish(failure('PYTHON_START_ABORTED', 'Python 启动检查已取消。')); };
    const timer = setTimeout(() => {
      child.kill(); finish(failure('PYTHON_START_TIMEOUT', `Python 版本检查超时（${command}）。${guidance}`));
    }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 16_384) { child.kill(); finish(failure('PYTHON_INVALID_RESPONSE', `Python 版本输出异常（${command}）。${guidance}`)); }
      else output += chunk;
    });
    child.stderr.resume();
    child.on('error', error => finish(failure('PYTHON_START_FAILED', `无法启动 Python（${command}，${error.code || '启动错误'}）。${guidance}`)));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { finish(failure('PYTHON_START_FAILED', `Python 版本检查失败（${command}，退出码 ${code}）。${guidance}`)); return; }
      try { finish(undefined, checkPythonVersion(JSON.parse(output.trim()), command)); }
      catch (error) { finish(error.code ? error : failure('PYTHON_INVALID_RESPONSE', `Python 版本检查未返回有效数据（${command}）。${guidance}`)); }
    });
  });
}
