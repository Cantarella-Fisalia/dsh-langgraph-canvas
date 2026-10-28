import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from dsh_langgraph_canvas_worker.analysis import Analyzer
from dsh_langgraph_canvas_worker.transactions import Transactions, TransactionError

GRAPH = '''from langgraph.graph import StateGraph, START, END
from schema import State
def work(state):
    return {}
g = StateGraph(State)
g.add_node("work", work)
g.add_edge(START, "work")
g.add_edge("work", END)
app = g.compile()
'''
SCHEMA = 'from typing import TypedDict\nclass State(TypedDict):\n    question: str\n'


class TransactionsTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(prefix='dsh-langgraph-canvas-transaction-test-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'graph.py').write_bytes(GRAPH.replace('\n', '\r\n').encode('utf-8-sig'))
        (root / 'schema.py').write_bytes(('# coding: gb18030\n' + SCHEMA.replace('question: str', 'question: str  # 原始字段')).encode('gb18030'))
        graph = Analyzer(root).scan()['graphs'][0]
        target = {'state': copy.deepcopy(graph['state']), 'nodes': [
            {'id': n['id'], 'functionRef': n.get('functionRef'), 'description': n.get('summary', '')}
            for n in graph['nodes']], 'edges': [{k: v for k, v in e.items() if k != 'source'} for e in graph['edges']]}
        target['state']['fields'].append({'name': 'answer', 'annotation': 'str'})
        target['nodes'].append({'id': 'review', 'functionRef': 'review', 'description': 'review answer'})
        target['edges'][-1]['to'] = 'review'
        target['edges'].append({'id': 'finish', 'from': 'review', 'to': '__end__', 'kind': 'normal'})
        original = {p.name: p.read_bytes() for p in root.glob('*.py')}
        preview = Transactions(root).prepare('transaction-test-001', graph['id'], graph['revision'], target)
        return root, preview['transaction'], original, graph, target

    def test_persisted_diff_confirmation_apply_idempotency_and_exact_byte_undo(self):
        root, tx, original, graph, target = self.fixture()
        store = Transactions(root)
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        detail = store.get(tx['id'])
        self.assertEqual(len(detail['files']), 2)
        self.assertTrue(all(f['diff'].startswith('--- a/') for f in detail['files']))
        self.assertFalse(any('_beforeBytes' in f for f in detail['files']))
        for confirmed, review, ack in [(False, tx['reviewHash'], True), (True, '0' * 64, True), (True, tx['reviewHash'], False)]:
            with self.assertRaises(TransactionError):
                store.execute(tx['id'], 'apply', confirmed, review, ack)
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        applied = store.execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        self.assertEqual(applied['transaction']['status'], 'applied')
        self.assertEqual(Analyzer(root).scan()['revision'], tx['generatedRevision'])
        self.assertEqual(Transactions(root).execute(tx['id'], 'apply', True, tx['reviewHash'], True)['transaction']['status'], 'applied')
        self.assertEqual(Transactions(root).list()['transactions'][0]['status'], 'applied')
        undone = Transactions(root).execute(tx['id'], 'undo', True, tx['reviewHash'])
        self.assertEqual(undone['transaction']['status'], 'undone')
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        self.assertEqual(Transactions(root).execute(tx['id'], 'undo', True, tx['reviewHash'])['transaction']['status'], 'undone')
        with self.assertRaises(TransactionError):
            store.execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        self.assertEqual(store.prepare('transaction-test-001', graph['id'], graph['revision'], target)['transaction']['status'], 'undone')

    def test_apply_and_undo_conflicts_never_overwrite_external_edits(self):
        root, tx, original, _, _ = self.fixture()
        store = Transactions(root)
        changed = original['schema.py'] + b'# external edit\n'
        (root / 'schema.py').write_bytes(changed)
        with self.assertRaisesRegex(TransactionError, '源码已被修改'):
            store.execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        self.assertEqual((root / 'schema.py').read_bytes(), changed)
        (root / 'schema.py').write_bytes(original['schema.py'])
        store.execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        changed = (root / 'graph.py').read_bytes() + b'# post apply external edit\r\n'
        (root / 'graph.py').write_bytes(changed)
        with self.assertRaises(TransactionError):
            store.execute(tx['id'], 'undo', True, tx['reviewHash'])
        self.assertEqual((root / 'graph.py').read_bytes(), changed)

    def test_failure_after_first_of_two_files_rolls_back(self):
        root, tx, original, _, _ = self.fixture()
        def fail(stage, index, path):
            if stage == 'before-write' and index == 1:
                raise OSError('injected disk failure')
        with self.assertRaisesRegex(TransactionError, 'injected disk failure'):
            Transactions(root, fail).execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        self.assertEqual(Transactions(root).get(tx['id'])['transaction']['status'], 'rolled_back')

    def test_crashed_apply_and_undo_recover_on_next_process(self):
        for operation in ['apply', 'undo']:
            with self.subTest(operation=operation):
                root, tx, original, _, _ = self.fixture()
                store = Transactions(root)
                if operation == 'undo':
                    store.execute(tx['id'], 'apply', True, tx['reviewHash'], True)
                before = {p.name: p.read_bytes() for p in root.glob('*.py')}
                def crash(stage, index, path):
                    if stage == 'after-write' and index == 0:
                        raise SystemExit('injected process crash')
                with self.assertRaises(SystemExit):
                    Transactions(root, crash).execute(tx['id'], operation, True, tx['reviewHash'], True)
                self.assertNotEqual(before, {p.name: p.read_bytes() for p in root.glob('*.py')})
                status = Transactions(root).list()['transactions'][0]['status']
                self.assertEqual(status, 'rolled_back' if operation == 'apply' else 'applied')
                self.assertEqual(before, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_recovery_conflict_preserves_third_version_and_requires_explicit_retry(self):
        root, tx, original, _, _ = self.fixture()
        def crash(stage, index, path):
            if stage == 'after-write' and index == 0:
                raise SystemExit()
        with self.assertRaises(SystemExit):
            Transactions(root, crash).execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        detail = Transactions(root).load(tx['id'])
        first = detail['files'][0]['file']
        changed = b'# third version\n' + (root / first).read_bytes()
        (root / first).write_bytes(changed)
        self.assertEqual(Transactions(root).list()['transactions'][0]['status'], 'recovery_required')
        self.assertEqual((root / first).read_bytes(), changed)
        with self.assertRaises(TransactionError):
            Transactions(root).execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        (root / first).write_bytes(original[first])  # User resolves conflict; retry is an explicit operation.
        recovered = Transactions(root).execute(tx['id'], 'recover', True, tx['reviewHash'])
        self.assertEqual(recovered['transaction']['status'], 'rolled_back')
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_cross_process_lock_and_corrupted_journal_prevent_writes(self):
        root, tx, original, graph, target = self.fixture()
        # Two store instances model separate owners; Windows byte locks / POSIX flock are OS-enforced.
        with Transactions(root).locked():
            with self.assertRaises(TransactionError) as result:
                Transactions(root).execute(tx['id'], 'apply', True, tx['reviewHash'], True)
            self.assertEqual(result.exception.code, 'PROJECT_LOCKED')
        path = Transactions(root).record_path(tx['id'])
        record = json.loads(path.read_text(encoding='utf-8')); record['files'][0]['file'] = '../outside.py'
        path.write_text(json.dumps(record), encoding='utf-8')
        with self.assertRaises(TransactionError) as result:
            Transactions(root).execute(tx['id'], 'apply', True, tx['reviewHash'], True)
        self.assertEqual(result.exception.code, 'INVALID_JOURNAL')
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})


if __name__ == '__main__':
    unittest.main()
