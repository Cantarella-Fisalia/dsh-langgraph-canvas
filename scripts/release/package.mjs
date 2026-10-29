/** Stage the complete runtime without rewriting imports or running install hooks. */
import { readFile, writeFile, mkdir, readdir, lstat, copyFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run release:package.');
const plugin = JSON.parse(await readFile(join(root, 'plugins/harness/package.json'), 'utf8'));
const output = resolve(root, '.tmp/releases', plugin.version);
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, 'package-'));
const files = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function copy(file) {
  const bytes = await readFile(join(root, file));
  await mkdir(dirname(join(staging, file)), { recursive: true });
  await copyFile(join(root, file), join(staging, file));
  files.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
}
async function tree(directory, accept) {
  for (const name of (await readdir(join(root, directory))).sort()) {
    const file = directory + '/' + name;
    const info = await lstat(join(root, file));
    if (info.isSymbolicLink()) throw new Error('Release input must not contain links: ' + file);
    if (info.isDirectory()) {
      if (!['__pycache__', '.vislang', 'node_modules'].includes(name)) await tree(file, accept);
    } else if (accept(file)) await copy(file);
  }
}
async function compile(directory) {
  for (const name of (await readdir(join(root, directory))).sort()) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts') || name.endsWith('.test.ts')) continue;
    const source = directory + '/' + name;
    const file = source.replace(/\.ts$/, '.js');
    const input = await readFile(join(root, source), 'utf8');
    const result = ts.transpileModule(input, { fileName: source, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
        rewriteRelativeImportExtensions: true, verbatimModuleSyntax: true } });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
    const bytes = Buffer.from(result.outputText);
    await mkdir(dirname(join(staging, file)), { recursive: true });
    await writeFile(join(staging, file), bytes);
    files.push({ path: file, bytes: bytes.length, sha256: hash(bytes), source, sourceSha256: hash(input) });
  }
}
const html = await readFile(join(root, 'apps/frontend/dist/index.html'), 'utf8');
if (!html.includes('./assets/')) throw new Error('Build frontend first: npm run build');
for (const [,asset] of html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)) {
  await readFile(join(root, 'apps/frontend/dist', asset));
}
const licenses = JSON.parse(await readFile(join(root, 'third_party_licenses/manifest.json'), 'utf8'));
for (const item of licenses.packages) {
  if (!/^third_party_licenses\/[^.][^\\]*$/.test(item.licenseFile) || item.licenseFile.includes('..')) throw new Error('Unsafe license path');
  if (hash(await readFile(join(root, item.licenseFile))) !== item.sha256 ||
      hash(await readFile(join(root, 'apps/frontend/dist', item.licenseFile))) !== item.sha256) {
    throw new Error('License copy differs; run npm run build: ' + item.licenseFile);
  }
}
for (const directory of ['apps/backend/src', 'packages/contracts/src']) {
  await compile(directory);
}
await tree('plugins/harness/lib', file => /\.(?:js|ts)$/.test(file));
await tree('plugins/harness/client', file => file.endsWith('.js'));
await tree('scripts/runtime', file => /\.(?:mjs|mts)$/.test(file));
await tree('services/python-worker/src', file => file.endsWith('.py'));
await tree('apps/frontend/dist', file => !file.endsWith('.map'));
await tree('third_party_licenses', () => true);
await tree('examples', file => /\.(?:py|md)$/.test(file));
for (const file of ['plugins/harness/cordis.patch.yml', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.en.md', 'USER_GUIDE.md']) await copy(file);
const manifest = {
  ...plugin, private: false,
  main: './plugins/harness/lib/index.js',
  exports: { '.': './plugins/harness/lib/index.js', './client': './plugins/harness/client/client.js',
    './cordis.patch.yml': './plugins/harness/cordis.patch.yml', './package.json': './package.json' },
  engines: { node: '>=24.0.0' },
  files: ['plugins/harness/lib', 'plugins/harness/client', 'plugins/harness/cordis.patch.yml',
    'apps/backend/src', 'apps/frontend/dist', 'packages/contracts/src', 'scripts/runtime',
    'services/python-worker/src', 'third_party_licenses', 'examples', 'RELEASE_MANIFEST.json', 'THIRD_PARTY_NOTICES.md', 'USER_GUIDE.md', 'README.en.md'],
  dsh: { ...plugin.dsh, bundle: { patch: './plugins/harness/cordis.patch.yml' } },
  repository: { type: 'git', url: plugin.repository.url },
};
delete manifest.scripts;
await writeFile(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
files.push({ path: 'package.json', sha256: hash(await readFile(join(staging, 'package.json'))) });
const sourceCommit = execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/').replace(/\/$/, ''), 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
await writeFile(join(staging, 'RELEASE_MANIFEST.json'), JSON.stringify({
  schemaVersion: 1, name: plugin.name, version: plugin.version, sourceCommit,
  sourceRepository: plugin.repository.url, generatedAt: new Date().toISOString(),
  node: process.version, requirements: { python: '>=3.11', node: '>=24', git: 'required for Git source installation' },
  installScripts: false, files,
}, null, 2) + '\n');
const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', output, '--cache', join(root, '.tmp/npm-cache')], {
  cwd: staging, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
}))[0];
const tarball = join(output, packed.filename);
const result = { name: plugin.name, version: plugin.version, sourceCommit, staging, tarball, sha256: hash(await readFile(tarball)), files: packed.entryCount, bytes: packed.size };
await writeFile(join(output, 'latest.json'), JSON.stringify(result, null, 2) + '\n');
await writeFile(join(output, 'SHA256SUMS'), result.sha256 + '  ' + packed.filename + '\n');
console.log(JSON.stringify(result, null, 2));
