import copy
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from dsh_langgraph_canvas_worker.analysis import Analyzer
from dsh_langgraph_canvas_worker.behavior import BehaviorTasks, decoded
from dsh_langgraph_canvas_worker.transactions import Transactions, TransactionError

GRAPH = '''from langgraph.graph import StateGraph, START, END
from schema import State
from nodes import work
g = StateGraph(State)
g.add_node("work", work)
g.add_edge(START, "work")
g.add_edge("work", END)
app = g.compile()
'''
NODES = 'def work(state):\n    """原有职责。"""\n    return {"answer": "old"}\n\ndef untouched(state):\n    return {}\n'


class BehaviorTests(unittest.TestCase):
    def test_legacy_workspace_keeps_exact_ownership_and_source_checks(self):
        root, store, prepared, workdir, original, tx = self.fixture()
        task = copy.deepcopy(store.load(prepared['task']['id']))
        for prefix in ('langcontour', 'vis4agent'):
            with self.subTest(previous_name=prefix), tempfile.TemporaryDirectory(prefix=prefix + '-behavior-') as directory:
                legacy = Path(directory).resolve()
                self.assertEqual(legacy.parent, Path(tempfile.gettempdir()).resolve())
                marker = '.' + prefix + '-owner.json'
                for file in workdir.iterdir():
                    name = marker if file.name == '.dsh-langgraph-canvas-owner.json' else file.name
                    shutil.copyfile(file, legacy / name)
                task['_workspace'] = str(legacy)
                self.assertEqual(set(store.snapshot(task)), set(task['_inputFiles']))
                (legacy / marker).write_text('wrong-owner', encoding='utf-8')
                with self.assertRaises(TransactionError):
                    store.workspace(task)

    def fixture(self, new_node=False, applied=False, route=False):
        temporary = tempfile.TemporaryDirectory(prefix='dsh-langgraph-canvas-behavior-test-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        graph_source, nodes_source = GRAPH, NODES
        if route:
            graph_source = GRAPH.replace('from nodes import work', 'from nodes import work, route').replace('g.add_edge("work", END)', 'g.add_conditional_edges("work", route, {True: END, False: "work"})')
            nodes_source += '\ndef route(state):\n    return True\n'
        (root / 'graph.py').write_text(graph_source, encoding='utf-8')
        (root / 'schema.py').write_text('from typing import TypedDict\nclass State(TypedDict):\n    question: str\n    answer: str\n', encoding='utf-8')
        (root / 'nodes.py').write_bytes(nodes_source.replace('\n', '\r\n').encode('utf-8-sig'))
        graph = Analyzer(root).scan()['graphs'][0]
        target = {'state': copy.deepcopy(graph['state']), 'nodes': [{'id': n['id'], 'functionRef': n.get('functionRef'), 'description': n.get('summary', '')} for n in graph['nodes']],
                  'edges': [{k: v for k, v in e.items() if k != 'source'} for e in graph['edges']]}
        if route:
            target['edges'].append({'id': 'new-branch', 'kind': 'conditional', 'from': 'work', 'to': '__end__', 'label': 'uncertain', 'route': 'route'})
        elif new_node:
            target['nodes'].append({'id': 'review', 'functionRef': 'review', 'description': '将 question 写入 answer。'})
            target['edges'][-1]['to'] = 'review'
            target['edges'].append({'id': 'finish', 'from': 'review', 'to': '__end__', 'kind': 'normal'})
        else:
            target['nodes'][0]['description'] = '将 question 转大写，写入 answer。'
        transaction = Transactions(root).prepare('behavior-template-001', graph['id'], graph['revision'], target)['transaction']
        if applied:
            Transactions(root).execute(transaction['id'], 'apply', True, transaction['reviewHash'], True)
        store = BehaviorTasks(root)
        prepared = store.prepare('behavior-request-001', transaction['id'], transaction['reviewHash'])
        workdir = Path(prepared['assignment']['workingDirectory'])
        def clean():
            # Exact test-owned target, never a computed user directory.
            resolved = workdir.resolve()
            assert resolved == workdir and resolved.parent == Path(tempfile.gettempdir()).resolve() and resolved.name.startswith('dsh-langgraph-canvas-behavior-')
            if resolved.exists():
                shutil.rmtree(resolved)
        self.addCleanup(clean)
        original = {p.name: p.read_bytes() for p in root.glob('*.py')}
        return root, store, prepared, workdir, original, transaction

    def edit(self, path, before, after):
        content, encoding = decoded(path.read_bytes())
        self.assertIn(before, content)
        path.write_bytes(content.replace(before, after).encode(encoding))

    def test_owned_copy_body_result_becomes_review_then_confirmed_apply_and_undo(self):
        root, store, prepared, workdir, original, tx = self.fixture()
        assignment = prepared['assignment']; task_id = prepared['task']['id']
        self.assertEqual(assignment['allowedFiles'], ['nodes.py'])
        self.assertFalse(assignment['originalProjectWriteAllowed']); self.assertFalse(assignment['executeProjectAllowed'])
        self.assertNotIn('projectRoot', assignment)
        self.edit(workdir / 'nodes.py', 'return {"answer": "old"}', 'return {"answer": state["question"].upper()}')
        result = BehaviorTasks(root).finalize(task_id)
        self.assertEqual(result['status'], 'review_ready', result['message'])
        self.assertFalse(workdir.exists())
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        detail = Transactions(root).get(result['resultTransactionId'])
        self.assertEqual(detail['transaction']['kind'], 'behavior')
        self.assertEqual(detail['transaction']['originRequestId'], tx['requestId'])
        self.assertEqual([f['file'] for f in detail['files']], ['nodes.py'])
        record = detail['transaction']
        Transactions(root).execute(record['id'], 'apply', True, record['reviewHash'], True)
        self.assertIn('upper()', decoded((root / 'nodes.py').read_bytes())[0])
        Transactions(root).execute(record['id'], 'undo', True, record['reviewHash'])
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})
        self.assertEqual(store.finalize(task_id)['resultTransactionId'], record['id'])

    def test_new_placeholder_can_run_before_or_after_structural_apply(self):
        for applied in [False, True]:
            with self.subTest(applied=applied):
                root, store, prepared, workdir, original, tx = self.fixture(new_node=True, applied=applied)
                self.edit(workdir / 'graph.py', 'raise NotImplementedError("dsh-langgraph-canvas: implement review")', 'return {"answer": state["question"]}')
                result = store.finalize(prepared['task']['id'])
                self.assertEqual(result['status'], 'review_ready', result['message'])
                detail = Transactions(root).get(result['resultTransactionId'])
                self.assertEqual(detail['baseRevision'], tx['generatedRevision'] if applied else tx['baseRevision'])
                self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_freezes_other_files_graph_state_signatures_functions_and_import_bindings(self):
        for change in ['graph', 'state', 'signature', 'other-function', 'import-collision', 'new-file', 'no-behavior-change', 'placeholder', 'invalid-await']:
            with self.subTest(change=change):
                root, store, prepared, workdir, original, _ = self.fixture()
                self.edit(workdir / 'nodes.py', 'return {"answer": "old"}', 'return {"answer": "new"}')
                if change == 'graph':
                    self.edit(workdir / 'graph.py', 'g.add_edge(START, "work")', 'g.add_edge(START, "missing")')
                elif change == 'state':
                    self.edit(workdir / 'schema.py', 'answer: str', 'answer: int')
                elif change == 'signature':
                    self.edit(workdir / 'nodes.py', 'def work(state):', 'def work(state, secret):')
                elif change == 'other-function':
                    self.edit(workdir / 'nodes.py', '    return {}', '    return {"changed": True}')
                elif change == 'import-collision':
                    self.edit(workdir / 'nodes.py', 'def work(state):', 'from evil import untouched\ndef work(state):')
                elif change == 'new-file':
                    (workdir / 'new.py').write_text('raise RuntimeError()', encoding='utf-8')
                elif change == 'no-behavior-change':
                    self.edit(workdir / 'nodes.py', 'return {"answer": "new"}', 'return {"answer": "old"}')
                elif change == 'placeholder':
                    self.edit(workdir / 'nodes.py', 'return {"answer": "new"}', 'raise NotImplementedError("still pending")')
                elif change == 'invalid-await':
                    self.edit(workdir / 'nodes.py', 'return {"answer": "new"}', 'return await missing()')
                result = store.finalize(prepared['task']['id'])
                self.assertEqual(result['status'], 'failed', result)
                self.assertNotIn('resultTransactionId', result)
                self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_additive_import_is_reviewed_without_executing_it(self):
        root, store, prepared, workdir, original, _ = self.fixture()
        self.edit(workdir / 'nodes.py', 'def work(state):', 'import nonexistent_test_only_module\ndef work(state):')
        self.edit(workdir / 'nodes.py', 'return {"answer": "old"}', 'return {"answer": state["question"]}')
        result = store.finalize(prepared['task']['id'])
        self.assertEqual(result['status'], 'review_ready', result['message'])
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_original_conflict_prevents_import_and_keeps_external_version(self):
        root, store, prepared, workdir, original, _ = self.fixture()
        self.edit(workdir / 'nodes.py', 'return {"answer": "old"}', 'return {"answer": "new"}')
        changed = original['nodes.py'] + b'# external change\r\n'; (root / 'nodes.py').write_bytes(changed)
        result = store.finalize(prepared['task']['id'])
        self.assertEqual(result['status'], 'conflicted')
        self.assertEqual((root / 'nodes.py').read_bytes(), changed)
        self.assertNotIn('resultTransactionId', result)

    def test_cancellation_requires_stopped_ack_and_never_imports_late_result(self):
        root, store, prepared, workdir, original, _ = self.fixture()
        task_id = prepared['task']['id']
        store.update(task_id, 'cancelling')
        self.assertEqual(store.update(task_id, 'running')['status'], 'cancelling')
        with self.assertRaises(TransactionError):
            store.finalize(task_id)
        with self.assertRaises(TransactionError):
            store.update(task_id, 'cancelled')
        value = store.update(task_id, 'cancelled', stopped=True)
        self.assertEqual(value['status'], 'cancelled'); self.assertFalse(workdir.exists())
        self.assertEqual(store.finalize(task_id)['status'], 'cancelled')
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_durable_dedup_and_lost_workspace(self):
        root, store, prepared, workdir, original, tx = self.fixture()
        again = BehaviorTasks(root).prepare('behavior-request-001', tx['id'], tx['reviewHash'])
        self.assertFalse(again['dispatch']); self.assertEqual(again['task']['id'], prepared['task']['id'])
        with self.assertRaises(TransactionError):
            store.prepare('behavior-request-001', tx['id'], '0' * 64)
        (workdir / '.dsh-langgraph-canvas-owner.json').unlink()
        result = store.finalize(prepared['task']['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})

    def test_changed_router_keys_preserve_typed_branch_context(self):
        root, store, prepared, workdir, original, _ = self.fixture(route=True)
        req = prepared['task']['requirements'][0]
        self.assertEqual(req['kind'], 'route'); self.assertEqual(req['branchValues'], [True, False, 'uncertain'])
        self.edit(workdir / 'nodes.py', 'return True', 'return "uncertain"')
        result = store.finalize(prepared['task']['id'])
        self.assertEqual(result['status'], 'review_ready', result['message'])
        self.assertEqual(original, {p.name: p.read_bytes() for p in root.glob('*.py')})


if __name__ == '__main__':
    unittest.main()
