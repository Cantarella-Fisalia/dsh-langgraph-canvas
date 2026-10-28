/** Real plugin module + minimal webServer/effect fixture. This is NOT a Harness desktop test. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' requires a value');
  return args[index + 1];
}
const repo = await realpath(resolve(option('--repo', fileURLToPath(new URL('../../', import.meta.url)))));
const reportPath = resolve(option('--report', join(repo, '.tmp/acceptance/latest.json')));
const harnessUrl = option('--harness-url');
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), repo, node: process.version,
  proof: 'actual-plugin-module-with-minimal-webServer-and-effect-fixture',
  realHarnessConnected: false, desktopAcceptance: 'not_performed',
  modelTasksSubmitted: 0, checks: [], blockers: [], sourceHashes: {},
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel);
};
async function snapshot(root) {
  const result = {};
  async function visit(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const file = join(dir, name), info = await lstat(file);
      assert.equal(info.isSymbolicLink(), false, 'Fixture source must not contain links');
      if (info.isDirectory() && !name.startsWith('.') && name !== '__pycache__') await visit(file);
      else if (info.isFile() && name.endsWith('.py')) result[relative(root, file).replaceAll('\\', '/')] = hash(await readFile(file));
    }
  }
  await visit(root);
  return result;
}
async function check(id, run) {
  const start = Date.now();
  try {
    const evidence = await run();
    report.checks.push({ id, status: 'passed', durationMs: Date.now() - start, evidence: evidence ?? null });
    console.log('[PASS] ' + id);
    return evidence;
  } catch (error) {
    report.checks.push({ id, status: 'failed', durationMs: Date.now() - start, error: error.message });
    throw error;
  }
}

let ownedRoot, server, streamReader, streamAbort, streamPump;
let registered, lifecycle;
const disposers = [];
const previousRepo = process.env.DSH_LANGGRAPH_CANVAS_REPO_ROOT;
try {
  // No user profile, credentials or original example directory is modified.
  process.env.DSH_LANGGRAPH_CANVAS_REPO_ROOT = repo;
  const pluginPath = join(repo, 'plugins/harness/lib/index.js');
  async function fingerprint(directory) {
    for (const name of (await readdir(join(repo, directory))).sort()) {
      if (name === '__pycache__') continue;
      const file = join(directory, name), info = await lstat(join(repo, file));
      assert.equal(info.isSymbolicLink(), false, 'Runtime source must not contain links');
      if (info.isDirectory()) await fingerprint(file);
      else if (/\.(?:ts|tsx|py|js)$/.test(name) && !name.endsWith('.test.ts')) {
        report.sourceHashes[file.replaceAll('\\', '/')] = hash(await readFile(join(repo, file)));
      }
    }
  }
  for (const directory of ['apps/backend/src', 'packages/contracts/src', 'services/python-worker/src']) await fingerprint(directory);
  report.sourceHashes['scripts/acceptance/preflight.mjs'] = hash(await readFile(fileURLToPath(import.meta.url)));
  report.sourceHashes['plugins/harness/lib/index.js'] = hash(await readFile(pluginPath));
  report.sourceHashes['plugins/harness/lib/behavior-adapter.js'] = hash(await readFile(join(repo, 'plugins/harness/lib/behavior-adapter.js')));
  report.sourceHashes['scripts/runtime/python.mjs'] = hash(await readFile(join(repo, 'scripts/runtime/python.mjs')));
  report.sourceHashes['apps/frontend/dist/index.html'] = hash(await readFile(join(repo, 'apps/frontend/dist/index.html')));
  const { apply } = await import(pathToFileURL(pluginPath).href);
  const { editableGraph } = await import(pathToFileURL(join(repo, 'packages/contracts/src/editing.ts')).href);
  await check('plugin-registration', () => {
    apply({
      webServer: { register(route) {
        assert.equal(route.kind, 'prefix'); assert.equal(route.path, '/dsh-langgraph-canvas');
        registered = route;
        return () => { registered = undefined; };
      } },
      effect(factory, label) {
        const dispose = factory();
        assert.equal(typeof dispose, 'function');
        let disposed = false;
        const once = () => { if (!disposed) { disposed = true; return dispose(); } };
        disposers.push(once);
        if (label.includes('application lifecycle')) lifecycle = once;
      },
    });
    assert.equal(disposers.length, 2); assert.ok(lifecycle);
    return { route: registered.path, effects: disposers.length };
  });
  server = createServer(async (req, res) => {
    try {
      if (registered && (req.url === registered.path || req.url.startsWith(registered.path + '/'))) await registered.handler(req, res);
      else { res.writeHead(404); res.end(); }
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(error.message); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const api = '/dsh-langgraph-canvas/api/v1';
  async function json(path, body, method = body === undefined ? 'GET' : 'POST', origin = 'dsh-app://app') {
    const response = await fetch(base + api + path, {
      method, headers: { 'content-type': 'application/json', origin },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35_000),
    });
    return { status: response.status, body: await response.json() };
  }
  await check('built-static-assets', async () => {
    const response = await fetch(base + '/dsh-langgraph-canvas/app/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(assets.some(a => a.endsWith('.js'))); assert.ok(assets.some(a => a.endsWith('.css')));
    const evidence = [];
    for (const asset of assets) {
      const url = new URL(asset, base + '/dsh-langgraph-canvas/app/');
      const result = await fetch(url); assert.equal(result.status, 200);
      assert.match(result.headers.get('cache-control') || '', /immutable/);
      const bytes = Buffer.from(await result.arrayBuffer());
      const file = 'apps/frontend/dist/' + asset.slice(2);
      assert.equal(hash(bytes), hash(await readFile(join(repo, file))));
      report.sourceHashes[file] = hash(bytes);
      evidence.push({ file, bytes: bytes.length, sha256: hash(bytes) });
    }
    const head = await fetch(base + '/dsh-langgraph-canvas/app/', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(base + '/dsh-langgraph-canvas/app/assets/missing.js')).status, 404);
    return evidence;
  });
  await check('third-party-license-materials', async () => {
    const notice = await readFile(join(repo, 'THIRD_PARTY_NOTICES.md'));
    const response = await fetch(base + '/dsh-langgraph-canvas/app/THIRD_PARTY_NOTICES.md');
    assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(notice));
    const inventory = JSON.parse(await readFile(join(repo, 'third_party_licenses/manifest.json'), 'utf8'));
    assert.ok(inventory.packages.length > 0);
    for (const item of inventory.packages) {
      assert.ok(item.licenseFile.startsWith('third_party_licenses/') && !item.licenseFile.includes('..'));
      const original = await readFile(join(repo, item.licenseFile));
      assert.equal(hash(original), item.sha256);
      const delivered = await fetch(base + '/dsh-langgraph-canvas/app/' + item.licenseFile);
      assert.equal(delivered.status, 200);
      assert.equal(hash(Buffer.from(await delivered.arrayBuffer())), item.sha256);
    }
    return { packages: inventory.packages.length, licenseTypes: [...new Set(inventory.packages.map(item => item.license))] };
  });
  await check('api-origin-and-prefix', async () => {
    const result = await json('/health');
    assert.equal(result.status, 200); assert.equal(result.body.sourceWrites, 'confirmed-transactions-only');
    assert.equal((await json('/health', undefined, 'GET', 'https://untrusted.example')).status, 403);
    assert.equal((await fetch(base + '/api/v1/health')).status, 404);
    assert.equal((await json('/not-a-route')).status, 404);
    return result.body;
  });
  ownedRoot = await mkdtemp(join(tmpdir(), 'dsh-langgraph-canvas-acceptance-'));
  const projects = {};
  await check('real-python-examples-in-owned-copies', async () => {
    const evidence = [];
    for (const name of ['research-team', 'parallel-team', 'router-team']) {
      const original = join(repo, 'examples', name), directory = join(ownedRoot, name);
      const before = await snapshot(original);
      await mkdir(directory);
      for (const file of Object.keys(before)) {
        await mkdir(dirname(join(directory, file)), { recursive: true });
        await writeFile(join(directory, file), await readFile(join(original, file)));
      }
      const result = await json('/projects', { root: directory });
      assert.equal(result.status, 200); assert.equal(result.body.analysis.graphs.length, 1);
      const graph = result.body.analysis.graphs[0];
      assert.equal(graph.nodes.filter(n => n.kind !== 'boundary').length, 3);
      assert.equal(graph.nodes.filter(n => n.kind === 'boundary').length, 2);
      assert.ok(graph.state.fields.length > 0);
      if (name === 'parallel-team') assert.ok(graph.edges.some(e => e.kind === 'join'));
      else assert.ok(graph.edges.some(e => e.kind === 'conditional'));
      assert.deepEqual(await snapshot(directory), before);
      assert.deepEqual(await snapshot(original), before);
      projects[name] = { ...result.body, directory, original, before };
      evidence.push({ name, graphId: graph.id, functionNodes: 3, boundaryNodes: 2, edges: graph.edges.length,
        stateFields: graph.state.fields.map(f => f.name), sourceHashes: before });
    }
    return evidence;
  });
  const p = projects['research-team'], path = '/projects/' + p.project.id, graph = p.analysis.graphs[0];
  const events = [];
  await check('sse-through-plugin', async () => {
    streamAbort = new AbortController();
    const response = await fetch(base + api + path + '/events', { headers: { origin: 'dsh-app://app' }, signal: streamAbort.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    streamReader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    streamPump = (async () => {
      while (true) {
        const chunk = await streamReader.read(); if (chunk.done) return;
        pending += decoder.decode(chunk.value, { stream: true });
        let index;
        while ((index = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, index); pending = pending.slice(index + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    })();
    // Attach a handler immediately so cleanup abort cannot produce an unhandled rejection.
    streamPump.catch(() => {});
    for (let i = 0; i < 100 && !events.length; ++i) await delay(20);
    assert.ok(events.length > 0); return { initialEvent: events[0] };
  });
  await check('layout-isolation-and-conflict', async () => {
    const route = path + '/layout', initial = await json(route + '?graphId=' + encodeURIComponent(graph.id));
    const payload = { graphId: graph.id, graphRevision: p.analysis.revision,
      baseRevision: initial.body.revision, positions: { research: { x: 90, y: 120 } } };
    assert.equal((await json(route, payload, 'PUT')).status, 200);
    assert.equal((await json(route, payload, 'PUT')).body.error.code, 'LAYOUT_CONFLICT');
    assert.deepEqual(await snapshot(p.directory), p.before);
    assert.deepEqual(JSON.parse(await readFile(join(p.directory, '.vislang/layout.json'), 'utf8')).graphs[graph.id].positions, payload.positions);
    assert.equal((await json(path + '/source?file=../outside.py')).status, 400);
    return { sourceUnchanged: true, layoutPersisted: true, staleSaveRejected: true };
  });
  const target = editableGraph(graph);
  target.state.fields.push({ name: 'acceptance_note', annotation: 'str' });
  let preview, confirm, txRoute;
  await check('preview-confirmation-and-no-source-write', async () => {
    const request = { schemaVersion: 1, requestId: 'final-preflight-source-001', graphId: graph.id,
      baseRevision: graph.revision, target, confirmed: true };
    assert.equal((await json(path + '/source-previews', { ...request, confirmed: false })).body.error.code, 'CONFIRMATION_REQUIRED');
    const result = await json(path + '/source-previews', request); assert.equal(result.status, 200);
    preview = result.body;
    assert.equal(preview.transaction.status, 'prepared'); assert.equal(preview.verified, true);
    assert.deepEqual(preview.files.map(f => f.file), ['state.py']);
    assert.deepEqual(await snapshot(p.directory), p.before);
    txRoute = path + '/transactions/' + preview.transaction.id;
    confirm = { schemaVersion: 1, confirmed: true, reviewHash: preview.transaction.reviewHash, acknowledgedWarnings: true };
    return { transactionId: preview.transaction.id, files: preview.files.map(f => f.file), originalUnchanged: true };
  });
  await check('confirmed-apply-review-and-byte-exact-undo', async () => {
    assert.equal((await json(txRoute + '/apply', { ...confirm, confirmed: false })).body.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal((await json(txRoute + '/apply', { ...confirm, reviewHash: '0'.repeat(64) })).body.error.code, 'REVIEW_CHANGED');
    assert.deepEqual(await snapshot(p.directory), p.before);
    const applied = await json(txRoute + '/apply', confirm); assert.equal(applied.body.transaction.status, 'applied');
    const generated = await snapshot(p.directory);
    const changed = Object.keys(generated).filter(file => generated[file] !== p.before[file]);
    assert.deepEqual(changed, ['state.py']);
    assert.ok((await json(path + '/graphs')).body.graphs[0].state.fields.some(f => f.name === 'acceptance_note'));
    const file = join(p.directory, 'state.py'), bytes = await readFile(file);
    const external = Buffer.concat([bytes, Buffer.from('\n# external acceptance edit\n')]);
    await writeFile(file, external);
    assert.equal((await json(txRoute + '/undo', confirm)).body.error.code, 'SOURCE_CHANGED');
    assert.deepEqual(await readFile(file), external);
    // Restore only this runner's deliberate edit, then exercise normal undo.
    await writeFile(file, bytes);
    assert.equal((await json(txRoute + '/undo', confirm)).body.transaction.status, 'undone');
    assert.deepEqual(await snapshot(p.directory), p.before);
    const history = await json(path + '/transactions');
    assert.ok(history.body.transactions.some(t => t.id === preview.transaction.id && t.status === 'undone'));
    return { changedFiles: changed, before: p.before, applied: generated,
      undone: await snapshot(p.directory), externalEditPreserved: true, durableHistory: true };
  });
  await check('behavior-readiness-without-fake-adapter', async () => {
    const support = await json('/behavior-support'); assert.equal(support.status, 200);
    report.behaviorSupport = support.body;
    if (!support.body.available) {
      report.readinessProbe = 'test-context-without-Harness-model-services';
      const result = await json(path + '/behavior-tasks', { schemaVersion: 1, requestId: 'final-preflight-behavior-001',
        transactionId: preview.transaction.id, reviewHash: preview.transaction.reviewHash, confirmed: true });
      assert.equal(result.body.error.code, 'HARNESS_NOT_CONNECTED');
      assert.deepEqual((await json(path + '/behavior-tasks')).body.tasks, []);
    }
    // If an adapter is later installed this runner does NOT submit a paid/model task automatically.
    assert.deepEqual(await snapshot(p.directory), p.before);
    return { available: support.body.available, modelTasksSubmitted: 0, originalUnchanged: true };
  });
  if (harnessUrl) await check('live-harness-readiness', async () => {
    const url = new URL(harnessUrl);
    assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash, 'Use a local Harness origin without credentials or query');
    const response = await fetch(new URL('/dsh-langgraph-canvas/api/v1/behavior-support', url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      report.blockers.push({ id: 'HARNESS_READINESS_UNCONFIRMED', message: '宿主能力查询 HTTP ' + response.status });
      return { status: response.status, modelTasksSubmitted: 0 };
    }
    const support = await response.json();
    report.realHarnessConnected = true;
    if (support.available !== true) report.blockers.push({ id: 'HARNESS_MODEL_NOT_READY', message: support.message });
    report.harnessReadiness = { origin: url.origin, ...support };
    return { ...support, modelTasksSubmitted: 0 };
  });
  await check('plugin-lifecycle-disposal', async () => {
    await lifecycle();
    await Promise.race([streamPump, delay(3000).then(() => { throw new Error('SSE remained open after disposal'); })]);
    const closed = await json('/health'); assert.equal(closed.status, 503); assert.equal(closed.body.error.code, 'CLOSED');
    for (const dispose of disposers.toReversed()) await dispose();
    assert.equal((await fetch(base + api + '/health')).status, 404);
    return { sseEnded: true, backendClosed: true, routeRemoved: true, eventsObserved: events.length,
      workerProcessExit: 'not_independently_observed' };
  });
  await check('repository-examples-preserved', async () => {
    for (const value of Object.values(projects)) assert.deepEqual(await snapshot(value.original), value.before);
    return { allThreeOriginalExamplesUnchanged: true };
  });
} catch (error) {
  report.error = { name: error.name, message: error.message };
  console.error('[FAIL] ' + error.message);
} finally {
  if (previousRepo === undefined) delete process.env.DSH_LANGGRAPH_CANVAS_REPO_ROOT;
  else process.env.DSH_LANGGRAPH_CANVAS_REPO_ROOT = previousRepo;
  for (const dispose of disposers.toReversed()) {
    try { await dispose(); } catch (error) { report.error ??= { message: 'Disposal failed: ' + error.message }; }
  }
  streamAbort?.abort();
  await streamPump?.catch(() => {});
  if (server) {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
  if (ownedRoot) {
    try {
      const actual = await realpath(ownedRoot), temp = await realpath(tmpdir());
      assert.ok(inside(temp, actual) && basename(actual).startsWith('dsh-langgraph-canvas-acceptance-'));
      assert.equal(await realpath(dirname(actual)), temp);
      await rm(actual, { recursive: true, force: true });
      report.fixtureCleaned = true;
    } catch (error) { report.error ??= { message: 'Fixture cleanup failed: ' + error.message }; }
  }
  report.preflight = report.error ? 'failed' : report.blockers.length ? 'blocked' : 'passed';
  report.acceptance = 'not_accepted';
  report.blockers.push({ id: 'DESKTOP_ACCEPTANCE_NOT_PERFORMED', owner: 'Harness integration',
    message: '需要真实桌面原生入口、工作区/主题、确认门禁、真实任务/取消/重载、写回与撤销的独立证据。' });
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ preflight: report.preflight, acceptance: report.acceptance,
    passed: report.checks.filter(c => c.status === 'passed').length, report: reportPath }));
  process.exitCode = report.error ? 1 : report.preflight === 'blocked' ? 2 : 0;
}
