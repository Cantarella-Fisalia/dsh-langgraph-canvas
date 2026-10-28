import { sessionFixture, session } from './session-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessAnalysisAdapter } from '../lib/analysis-adapter.js';
import { inspectAnalysisEvidence } from '../lib/analysis-evidence.js';

const context = { revision: 'a'.repeat(64), files: [
  { file: 'graph.py', lines: 10, score: 8, imports: [], symbols: [] },
  { file: 'nodes.py', lines: 5, score: 0, imports: [], symbols: [] },
], staticGraphs: [], limitReached: false };
function fixture(responses) {
  const f = sessionFixture(async function* (request) {
    const response = responses.shift();
    if (typeof response === 'function') { yield* response(request); return; }
    yield { type: 'text-delta', index: 0, text: JSON.stringify(response) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  return { adapter: createHarnessAnalysisAdapter(f.ctx), calls: f.calls };
}
const raw = text => async function* () {
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'finish', reason: { kind: 'stop' } };
};
const options = extra => ({ session, signal: new AbortController().signal, progress() {},
  readSource: async range => ({ ...range, text: 'source' }), ...extra });
const explanation = (file = 'nodes.py', line = 1, endLine = 5) => ({ graphs: [], architecture: { schemaVersion: 1,
  overview: { text: 'synthetic claim', evidence: [{ file, line, endLine }] }, graphs: [], relationships: [], unresolved: [] } });

test('Chinese name evidence participates in current-task missing-source reads', () => {
  const value = explanation('graph.py', 1, 2);
  value.architecture.graphs = [{ nodes: [{ nodeId: 'work', displayName: { text: '检索资料', evidence: [{ file: 'nodes.py', line: 1, endLine: 3 }] } }] }];
  assert.deepEqual(inspectAnalysisEvidence(value, context.files, [{ file: 'graph.py', line: 1, endLine: 10 }]), [{ file: 'nodes.py', line: 1, endLine: 3, column: 0 }]);
});

test('a new task re-reads citations from previous native history and asks the model to recheck', async () => {
  const { adapter, calls } = fixture([{ readFiles: [{ file: 'nodes.py', line: 1, endLine: 5 }] }, explanation(), explanation(), explanation()]);
  await adapter.analyze(context, options());
  const reads = [], progress = [];
  await adapter.analyze(context, options({ readSource: async range => { reads.push(range.file); return { ...range, text: 'CURRENT_SOURCE' }; }, progress: text => progress.push(text) }));
  assert.equal(calls.length, 4); assert.deepEqual(reads, ['graph.py', 'nodes.py']);
  const opening = calls[2].messages.at(-1).content[0].text;
  const correction = calls[3].messages.at(-1).content[0].text;
  assert.match(opening, /CURRENT TASK ONLY/); assert.match(correction, /evidenceCorrection/);
  assert.match(correction, /CURRENT_SOURCE/); assert.match(correction, /重新核对/);
  const initialId = /"analysisId":"([^"]+)"/.exec(calls[0].messages.at(-1).content[0].text)[1];
  const newId = /"analysisId":"([^"]+)"/.exec(opening)[1];
  assert.notEqual(initialId, newId); assert.ok(correction.includes(newId));
  assert.ok(calls.every(call => call.tools.length === 0 && call.model === 'test-only'));
  assert.ok(progress.some(text => /补读/.test(text)));
});

test('evidence preflight merges current adjacent reads but re-reads gaps and stale versions', () => {
  const files = [{ file: 'nodes.py', lines: 20, hash: 'current' }];
  const reads = [{ file: 'nodes.py', line: 1, endLine: 5, hash: 'current' }, { file: 'nodes.py', line: 6, endLine: 10, hash: 'current' }];
  assert.deepEqual(inspectAnalysisEvidence(explanation('nodes.py', 3, 9), files, reads), []);
  reads[1].line = 7;
  assert.deepEqual(inspectAnalysisEvidence(explanation('nodes.py', 3, 9), files, reads), [{ file: 'nodes.py', line: 6, endLine: 6, column: 0 }]);
  reads[1].hash = 'old';
  assert.deepEqual(inspectAnalysisEvidence(explanation('nodes.py', 3, 9), files, reads), [{ file: 'nodes.py', line: 6, endLine: 9, column: 0 }]);
});

test('automatic evidence reads batch six ranges, split long spans and do not trust arbitrary extra keys', async () => {
  const many = { ...context, files: [...context.files, ...Array.from({ length: 7 }, (_, i) => ({ file: `extra${i}.py`, lines: 610, score: 0, imports: [], symbols: [] }))] };
  const value = explanation('extra0.py', 1, 610);
  value.architecture.overview.evidence = Array.from({ length: 7 }, (_, i) => ({ file: `extra${i}.py`, line: 1, endLine: i === 0 ? 610 : 1 }));
  value.ignored = { file: '../NOT_A_READ.py', line: 1, endLine: 1 };
  const { adapter, calls } = fixture([value, value, value]);
  const reads = [];
  await adapter.analyze(many, options({ readSource: async range => { reads.push(range); return { ...range, text: 'source' }; } }));
  assert.equal(calls.length, 3); assert.equal(reads.length, 10);
  assert.ok(reads.every(range => range.endLine - range.line < 300));
  for (const call of calls.slice(1)) {
    const payload = JSON.parse(call.messages.at(-1).content[0].text.split('\n').slice(1).join('\n'));
    assert.ok(payload.sources.length <= 6); assert.ok(payload.remainingModelCalls < 6);
  }
});

test('fragmented nearby citations share a bounded context read instead of exhausting rounds', () => {
  const value = explanation();
  value.architecture.overview.evidence = Array.from({ length: 10 }, (_, i) => ({ file: 'nodes.py', line: 1 + 20 * i, endLine: 1 + 20 * i }));
  assert.deepEqual(inspectAnalysisEvidence(value, [{ file: 'nodes.py', lines: 500 }], []), [{ file: 'nodes.py', line: 1, endLine: 181, column: 0 }]);
});

test('unauthorized or out-of-file citations fail before any automatic read', async () => {
  for (const value of [explanation('../outside.py'), explanation('nodes.py', 1, 6), explanation('docs/demo.py'), explanation('nodes.py', true, 2)]) {
    const { adapter, calls } = fixture([value]); const reads = [];
    await assert.rejects(adapter.analyze(context, options({ readSource: async range => { reads.push(range.file); return range; } })), /不在本次业务索引内/);
    assert.equal(calls.length, 1); assert.deepEqual(reads, ['graph.py']);
  }
});

test('last-round unread evidence fails without retroactively adopting or reading it', async () => {
  const request = { readFiles: [{ file: 'graph.py', line: 1, endLine: 1 }] };
  const { adapter, calls } = fixture([...Array(5).fill(request), explanation()]);
  const reads = [];
  await assert.rejects(adapter.analyze(context, options({ readSource: async range => { reads.push(range.file); return range; } })), /nodes.py:1–5.*6 轮预算已用尽/);
  assert.equal(calls.length, 6); assert.ok(!reads.includes('nodes.py'));
});

test('cancellation during missing-evidence read stops before the recheck model call', async () => {
  const { adapter, calls } = fixture([explanation()]); const controller = new AbortController();
  await assert.rejects(adapter.analyze(context, options({ signal: controller.signal, readSource: async range => {
    if (range.file === 'nodes.py') controller.abort(new Error('已取消'));
    return { ...range, text: 'source' };
  } })), /已取消/);
  assert.equal(calls.length, 1);
});

test('unclosed long JSON is corrected once in the same conversation without guessing the payload', async () => {
  // Synthetic reproduction of an outer brace omitted after a nested explanation.
  const malformed = JSON.stringify({ graphs: [], architecture: { schemaVersion: 1, overview: { text: '说明'.repeat(22000), evidence: [] }, message: 'nested' } }).slice(0, -1);
  const fixed = { graphs: [], architecture: { schemaVersion: 1, graphs: [] }, unresolved: ['尚待确认'], message: 'corrected' };
  const { adapter, calls } = fixture([raw(malformed), fixed]);
  const progress = [], reads = [];
  assert.deepEqual(await adapter.analyze(context, options({ progress: text => progress.push(text),
    readSource: async range => { reads.push(range.file); return { ...range, text: 'source' }; } })), fixed);
  assert.equal(calls.length, 2); assert.deepEqual(reads, ['graph.py']);
  assert.ok(calls.every(call => call.tools.length === 0 && call.provider === 'fixture' && call.model === 'test-only'));
  const second = calls[1].messages;
  assert.equal(second.find(m => m.role === 'assistant').content[0].text, malformed);
  assert.match(second.at(-1).content[0].text, /formatCorrection/);
  assert.match(second.at(-1).content[0].text, /"remainingModelCalls":5/);
  assert.ok(progress.some(text => /自动纠正.*2\/6/.test(text)));
});

test('a complete JSON fence is accepted without a correction request', async () => {
  const { adapter, calls } = fixture([raw('\uFEFF```JSON\r\n{"graphs":[],"message":"ok"}\r\n```')]);
  assert.equal((await adapter.analyze(context, options())).message, 'ok');
  assert.equal(calls.length, 1);
});

test('a second invalid reply fails without exposing provider text or reading partial requests', async () => {
  const invalid = '{"readFiles":[{"file":"unread.py","line":1,"endLine":3}],"secret":"PRIVATE_REPLY"';
  const { adapter, calls } = fixture([raw(invalid), raw(invalid)]);
  const reads = [];
  await assert.rejects(adapter.analyze(context, options({ readSource: async range => { reads.push(range.file); return range; } })), error => {
    assert.match(error.message, /自动纠正一次.*无效 JSON/);
    assert.doesNotMatch(error.message, /PRIVATE_REPLY|unread.py/); return true;
  });
  assert.equal(calls.length, 2); assert.deepEqual(reads, ['graph.py']);
});

test('format correction cannot exceed the shared six-round limit', async () => {
  const read = { readFiles: [{ file: 'nodes.py', line: 1, endLine: 1 }] };
  const { adapter, calls } = fixture([...Array(5).fill(read), raw('{"graphs":[]')]);
  await assert.rejects(adapter.analyze(context, options()), /6 轮预算已用尽/);
  assert.equal(calls.length, 6);
});

test('a corrected source request continues the original bounded read flow', async () => {
  const { adapter, calls } = fixture([raw('{"readFiles":['), { readFiles: [{ file: 'nodes.py', line: 1, endLine: 1 }] }, { graphs: [] }]);
  const reads = [];
  await adapter.analyze(context, options({ readSource: async range => { reads.push(range.file); return range; } }));
  assert.equal(calls.length, 3); assert.deepEqual(reads, ['graph.py', 'nodes.py']);
  assert.match(calls[2].messages.at(-1).content[0].text, /"remainingModelCalls":4/);
});

test('cancelling during format correction prevents further requests and ignores late JSON', async () => {
  const controller = new AbortController();
  let entered;
  const entry = new Promise(resolve => { entered = resolve; });
  const { adapter, calls } = fixture([raw('{"graphs":['), async function* () {
    entered(); await new Promise(resolve => setTimeout(resolve, 70));
    yield { type: 'text-delta', index: 0, text: '{"graphs":[]}' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }]);
  const pending = adapter.analyze(context, options({ signal: controller.signal }));
  await entry; controller.abort();
  await assert.rejects(pending, /取消|abort/i); assert.equal(calls.length, 2);
});

test('abnormal model termination is never treated as recoverable JSON formatting', async () => {
  const { adapter, calls } = fixture([async function* () {
    yield { type: 'text-delta', index: 0, text: '{"graphs":[' };
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  }]);
  await assert.rejects(adapter.analyze(context, options()), /正常完成|输出上限/);
  assert.equal(calls.length, 1);
});
test('Harness analysis uses current conversation, reads more files and has no tools or automatic calls', async () => {
  const { adapter, calls } = fixture([{ readFiles: [{ file: 'nodes.py', line: 1, endLine: 5 }] }, { graphs: [], message: 'done' }]);
  assert.equal((await adapter.support(session)).available, true);
  assert.equal(calls.length, 0);
  const reads = [];
  const result = await adapter.analyze(context, { session, signal: new AbortController().signal, progress() {},
    async readSource(range) { reads.push(range.file); return { ...range, text: 'source', hash: 'a'.repeat(64) }; } });
  assert.deepEqual(result.graphs, []);
  assert.deepEqual(reads, ['graph.py', 'nodes.py']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.provider === 'fixture' && call.model === 'test-only' && call.tools.length === 0));
  assert.match(calls[1].messages.at(-1).content[0].text, /nodes.py/);
  assert.ok(calls[0].messages.every(message => message.id && message.source));
  assert.match(calls[0].messages[0].content[0].text, /architecture.*explanation/);
  assert.match(calls[0].messages[0].content[0].text, /branch label is not the condition/);
});
test('missing provider and model tool calls fail explicitly', async () => {
  assert.equal((await createHarnessAnalysisAdapter({}).support(session)).available, false);
  const { adapter } = fixture([async function* () { yield { type: 'tool-call-delta' }; }]);
  await assert.rejects(adapter.analyze(context, { session, signal: new AbortController().signal, progress() {}, readSource: async r => ({ ...r, text: '' }) }), /工具|正常完成/);
});
test('cancelling stalled stream stops waiting and ignores late results', async () => {
  const { adapter } = fixture([async function* () { await new Promise(resolve => setTimeout(resolve, 70)); yield { type: 'finish', reason: { kind: 'stop' } }; }]);
  const controller = new AbortController();
  const pending = adapter.analyze(context, { session, signal: controller.signal, progress() {}, readSource: async r => ({ ...r, text: '' }) });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /取消|abort/i);
});
