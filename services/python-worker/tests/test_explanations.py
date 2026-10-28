import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from dsh_langgraph_canvas_worker import deep_analysis as deep
from dsh_langgraph_canvas_worker.analysis import Analyzer, digest

SOURCE = '''from langgraph.graph import StateGraph, START, END
from state import State
def work(state):
    return {'attempts': state.get('attempts', 0) + 1}
def route(state):
    return 'again' if state['attempts'] < 3 else 'done'
g = StateGraph(State)
g.add_node('work', work)
g.add_edge(START, 'work')
g.add_conditional_edges('work', route, {'again': 'work', 'done': END})
h = StateGraph(State)
h.add_node('finish', work)
h.add_edge(START, 'finish')
h.add_edge('finish', END)
raise RuntimeError('must never execute')
'''


class ExplanationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / 'graph.py').write_text(SOURCE, encoding='utf-8')
        (self.root / 'state.py').write_text('from typing import TypedDict\nclass State(TypedDict):\n    attempts: int\n    question: str\n', encoding='utf-8')
        self.ctx = deep.context(self.root)
        self.evidence = [deep.read_source(self.root, {'file': f['file'], 'line': 1, 'endLine': f['lines']}, self.ctx['files']) for f in self.ctx['files']]
        self.edge = next(e for e in self.ctx['staticGraphs'][0]['edges'] if e['kind'] == 'conditional')

    def claim(self, text='尝试次数小于三时，返回 again 并再次执行 work。', file='graph.py', line=6):
        return {'text': text, 'evidence': [{'file': file, 'line': line, 'endLine': line}]}

    def payload(self):
        return {'graphs': [], 'architecture': {'schemaVersion': 1, 'overview': self.claim(), 'graphs': [
            {'graphId': 'graph.py::g', 'purpose': self.claim(), 'entry': self.claim('从调用者接收 State，先执行 work。', line=9),
             'exit': self.claim('route 返回 done 时结束；调用者拿到什么还需追踪。', line=10),
             'stateFields': [{'name': 'attempts', 'role': 'intermediate', 'meaning': self.claim('已经尝试的次数，由 work 增加。', line=4), 'readers': ['work'], 'writers': ['work']}],
             'nodes': [{'nodeId': 'work', 'execution': 'function', 'summary': self.claim('读取次数并加一。', line=4), 'reads': ['attempts'], 'writes': ['attempts'], 'calls': []}],
             'conditions': [{'edgeId': self.edge['id'], 'when': self.claim()}]}],
             'relationships': [{'fromGraphId': 'graph.py::g', 'toGraphId': 'graph.py::h', 'kind': 'shared_state',
                 'explanation': self.claim('两图使用同一 State 定义，不代表存在执行调用。', line=11), 'callPath': []}],
             'unresolved': ['没有确认两图之间存在执行调用关系。']}}

    def validate(self, value=None, evidence=None):
        return deep.validate(self.root, value or self.payload(), self.ctx['revision'], self.evidence if evidence is None else evidence)

    def test_explanation_is_additive_complete_static_structure_and_source_unchanged(self):
        before = Analyzer(self.root).scan()
        result = self.validate()
        self.assertEqual(result['graphs'], [])
        self.assertEqual(result['architecture']['revision'], self.ctx['revision'])
        self.assertEqual(result['architecture']['graphs'][0]['conditions'][0]['when']['text'], self.claim()['text'])
        deep.store(self.root, result)
        cached = deep.cached(self.root, self.ctx['revision'])
        self.assertEqual(cached['architecture'], result['architecture'])
        self.assertEqual(Analyzer(self.root).scan(), before)
        self.assertEqual((self.root / 'graph.py').read_text(encoding='utf-8'), SOURCE)
        self.assertNotIn('text', result['evidence'][0])

    def test_claim_requires_actual_read_source_not_just_existing_file(self):
        with self.assertRaisesRegex(ValueError, '必须先读取'):
            self.validate(evidence=[])
        value = self.payload()
        value['architecture']['overview']['evidence'] = []
        with self.assertRaisesRegex(ValueError, '源码证据'):
            self.validate(value)

    def test_chinese_display_name_is_evidenced_cached_and_additive(self):
        value = self.payload()
        value['architecture']['graphs'][0]['nodes'][0]['displayName'] = self.claim('更新尝试次数', line=4)
        original = Analyzer(self.root).scan()
        result = self.validate(value)
        self.assertEqual(result['architecture']['graphs'][0]['nodes'][0]['displayName']['text'], '更新尝试次数')
        self.assertEqual(result['graphs'], [])
        deep.store(self.root, result)
        self.assertEqual(deep.cached(self.root, self.ctx['revision'])['architecture']['graphs'][0]['nodes'][0]['displayName']['text'], '更新尝试次数')
        self.assertEqual(Analyzer(self.root).scan(), original)
        self.assertNotIn('displayName', self.validate()['architecture']['graphs'][0]['nodes'][0])

    def test_invalid_or_unread_chinese_name_is_rejected(self):
        for name in ['retrieve_documents', '检查' * 20, '']:
            value = self.payload()
            value['architecture']['graphs'][0]['nodes'][0]['displayName'] = self.claim(name)
            with self.assertRaises(ValueError): self.validate(value)
        value = self.payload()
        value['architecture']['graphs'][0]['nodes'][0]['displayName'] = self.claim('检索资料', line=999)
        with self.assertRaises(ValueError): self.validate(value)

    def test_unknown_graph_field_node_condition_and_reads_rejected(self):
        for key in ['graph', 'field', 'node', 'edge', 'reads']:
            with self.subTest(key=key):
                value = self.payload()
                graph = value['architecture']['graphs'][0]
                if key == 'graph': graph['graphId'] = 'missing.py::g'
                if key == 'field': graph['stateFields'][0]['name'] = 'invented'
                if key == 'node': graph['nodes'][0]['nodeId'] = 'invented'
                if key == 'edge': graph['conditions'][0]['edgeId'] = 'invented'
                if key == 'reads': graph['nodes'][0]['reads'] = ['invented']
                with self.assertRaises(ValueError): self.validate(value)

    def test_direct_function_cannot_be_relabeled_as_function_group_or_subgraph(self):
        for execution in ['group', 'subgraph', 'callable']:
            value = self.payload()
            value['architecture']['graphs'][0]['nodes'][0]['execution'] = execution
            with self.assertRaises(ValueError): self.validate(value)

    def test_indirect_call_requires_known_node_and_evidenced_hops(self):
        value = self.payload()
        relation = value['architecture']['relationships'][0]
        relation.update(kind='indirect_call', viaNodeId='work')
        with self.assertRaisesRegex(ValueError, '调用链'): self.validate(value)
        relation['callPath'] = [{'name': 'caller', 'source': self.claim()['evidence'][0]}, {'name': 'callee', 'source': self.claim(line=11)['evidence'][0]}]
        self.assertEqual(self.validate(value)['architecture']['relationships'][0]['kind'], 'indirect_call')
        relation['kind'] = 'registered_subgraph'
        with self.assertRaisesRegex(ValueError, '不能宣称直接注册'): self.validate(value)

    def test_partial_explanation_preserves_unexplained_fields_and_cache_rechecks_ids(self):
        result = self.validate()
        self.assertEqual(len(result['architecture']['graphs'][0]['stateFields']), 1)
        self.assertEqual(len(self.ctx['staticGraphs'][0]['state']['fields']), 2)
        deep.store(self.root, result)
        path = deep.cache_path(self.root)
        record = json.loads(path.read_text(encoding='utf-8'))
        record['data']['architecture']['graphs'][0]['graphId'] = 'invented'
        record['digest'] = digest(json.dumps(record['data'], ensure_ascii=False, sort_keys=True).encode())
        path.write_text(json.dumps(record), encoding='utf-8')
        self.assertIsNone(deep.cached(self.root, self.ctx['revision']))

    def test_explanation_cache_invalidates_after_source_change_and_router_source_is_available(self):
        self.assertEqual(self.edge['routerSource']['line'], 5)
        self.assertEqual(self.ctx['staticGraphs'][0]['nodes'][0]['execution'], 'function')
        self.assertEqual(self.ctx['staticGraphs'][0]['state']['source']['file'], 'state.py')
        deep.store(self.root, self.validate())
        (self.root / 'state.py').write_text('class State: pass\n', encoding='utf-8')
        self.assertIsNone(deep.cached(self.root, Analyzer(self.root).scan()['revision']))
