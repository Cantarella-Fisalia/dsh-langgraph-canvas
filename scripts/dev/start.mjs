import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const children = [
  spawn(process.execPath, ['--watch', 'apps/backend/src/server.ts'], { cwd, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/frontend/vite.config.ts'], { cwd, stdio: 'inherit', windowsHide: true }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; children.forEach(child => child.kill()); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
children.forEach(child => { child.on('error', error => { console.error(error); stop(); process.exitCode = 1; }); child.on('exit', code => { if (!stopping) { process.exitCode = code || 0; stop(); } }); });
