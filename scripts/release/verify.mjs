/** Install the packed artifact outside the source tree; exercise its real runtime. */
import { readFile, writeFile, mkdtemp, realpath, mkdir } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(await readFile(join(root, 'plugins/harness/package.json'), 'utf8')).version;
const release = JSON.parse(await readFile(join(root, '.tmp/releases', version, 'latest.json'), 'utf8'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run release:verify.');
const directory = await mkdtemp(join(tmpdir(), 'dsh-canvas-release-'));
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
for (const brand of ['DSH_LANGGRAPH_CANVAS', 'LANGCONTOUR', 'VIS4AGENT']) delete env[brand + '_REPO_ROOT'];
await writeFile(join(directory, 'package.json'), '{"name":"isolated-release-check","private":true}\n');
execFileSync(process.execPath, [npm, 'install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund',
  '--cache', join(root, '.tmp/npm-cache'), release.tarball], { cwd: directory, env, windowsHide: true, stdio: 'pipe' });
const installed = await realpath(join(directory, 'node_modules/dsh-langgraph-canvas'));
const rel = relative(await realpath(root), installed);
assert.ok(isAbsolute(rel) || rel.startsWith('..'), 'Installed package must be outside source repository');
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(manifest.version, version);
assert.equal(manifest.scripts, undefined, 'No installation/build hooks');
assert.equal(manifest.dsh.bundle.patch, './plugins/harness/cordis.patch.yml');
for (const entry of Object.values(manifest.exports)) await readFile(join(installed, entry));
const inventory = JSON.parse(await readFile(join(installed, 'RELEASE_MANIFEST.json'), 'utf8'));
for (const entry of inventory.files) assert.equal(createHash('sha256').update(await readFile(join(installed, entry.path))).digest('hex'), entry.sha256, entry.path);
const resolved = execFileSync(process.execPath, ['--input-type=module', '-e', 'console.log(import.meta.resolve("dsh-langgraph-canvas")); console.log(import.meta.resolve("dsh-langgraph-canvas/client"));'], {
  cwd: directory, env, encoding: 'utf8', windowsHide: true,
}).trim().split(/\r?\n/);
assert.equal(resolved[0], pathToFileURL(join(installed, manifest.main)).href);
// No REPO_ROOT override: the entry must resolve all resources from its installed location.
const smoke = join(directory, 'entry-smoke.mjs');
await writeFile(smoke, `import { apply } from 'dsh-langgraph-canvas';\nlet route;const disposers=[];apply({webServer:{register(r){route=r;return()=>{}}},effect(f){disposers.push(f())}});\nimport { createServer } from 'node:http';\nconst server=createServer((q,s)=>route.handler(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));\ntry{const base='http://127.0.0.1:'+server.address().port;for(const p of ['/app/','/api/v1/health']){const r=await fetch(base+'/dsh-langgraph-canvas'+p);if(r.status!==200)throw new Error(p+' HTTP '+r.status)}}finally{for(const d of disposers.reverse())await d();server.closeAllConnections();await new Promise(r=>server.close(r))}\n`);
execFileSync(process.execPath, [smoke], { cwd: directory, env, windowsHide: true, stdio: 'inherit', timeout: 30000 });
const report = join(root, '.tmp/releases', version, 'installed-preflight.json');
execFileSync(process.execPath, [join(root, 'scripts/acceptance/preflight.mjs'), '--repo', installed, '--report', report], {
  cwd: directory, env, windowsHide: true, stdio: 'inherit', timeout: 120000,
});
const preflight = JSON.parse(await readFile(report, 'utf8'));
assert.equal(preflight.preflight, 'passed');
const result = { status: 'passed', version, sourceCommit: release.sourceCommit, tarballSha256: release.sha256,
  isolatedDirectory: directory, installed, importResolution: resolved, sourceRepoOverride: false,
  verifiedFiles: inventory.files.length, preflightChecks: preflight.checks.length, desktopInteraction: false, modelCalls: 0 };
await writeFile(join(dirname(report), 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
