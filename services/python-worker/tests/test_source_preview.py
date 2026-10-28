import ast
import copy
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from vislang_worker.analysis import Analyzer
from vislang_worker.source_preview import generate, shape

BASE = '''from typing import TypedDict
from langgraph.graph import StateGraph, START, END
class State(TypedDict):
    """Shared schema."""
    question: str  # keep field comment

def work(state):
    """Keep existing behavior."""
    return {"question": state["question"]}  # unchanged function

g = StateGraph(State)
g.add_node('work', work)  # keep registration comment
g.add_edge(START, "work")
g.add_edge("work", END)
app = g.compile()
'''


class SourcePreviewTests(unittest.TestCase):
    def fixture(self, files=None):
        temporary = tempfile.TemporaryDirectory(prefix='vis4agent-source-test-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for file, value in (files or {'graph.py': BASE}).items():
            path = root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value if isinstance(value, bytes) else value.encode())
        analysis = Analyzer(root).scan()
        graph = analysis['graphs'][0]
        target = {'state': copy.deepcopy(graph['state']), 'nodes': [
            {'id': n['id'], 'functionRef': n.get('functionRef'), 'description': n.get('summary', '')}
            for n in graph['nodes']], 'edges': [{k: v for k, v in e.items() if k != 'source'} for e in graph['edges']]}
        return root, graph, target

    def run_preview(self, root, graph, target):
        before = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()}
        result = generate(root, graph['id'], graph['revision'], target)
        self.assertEqual(before, {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()})
        self.assertTrue(result['verified'])
        return result

    def test_cross_file_state_add_keeps_functions_and_format(self):
        source = BASE.replace('class State(TypedDict):\n    """Shared schema."""\n    question: str  # keep field comment\n', 'from schema import State\n')
        root, graph, target = self.fixture({'graph.py': source, 'schema.py': 'from typing import TypedDict\nclass State(TypedDict):\n    question: str  # hello\n'})
        target['state']['fields'].append({'name': 'answer', 'annotation': 'str | None'})
        result = self.run_preview(root, graph, target)
        self.assertEqual([f['file'] for f in result['files']], ['schema.py'])
        self.assertIn('    answer: str | None\n    question: str  # hello', result['files'][0]['after'])

    def test_add_node_and_edges_creates_explicit_placeholder(self):
        root, graph, target = self.fixture()
        target['nodes'].append({'id': 'review', 'functionRef': 'review', 'description': '检查回答 "安全引用"'})
        target['edges'][-1]['to'] = 'review'
        target['edges'].append({'id': 'new-edge', 'kind': 'normal', 'from': 'review', 'to': '__end__'})
        result = self.run_preview(root, graph, target)
        after = result['files'][0]['after']
        self.assertEqual(result['placeholders'], ['review'])
        self.assertIn('raise NotImplementedError', after)
        self.assertIn("g.add_node('work', work)  # keep registration comment", after)
        self.assertIn('return {"question": state["question"]}  # unchanged function', after)
        self.assertLess(after.index('def review('), after.index('g = StateGraph'))
        self.assertLess(after.index('g.add_node("review"'), after.index('app = g.compile()'))

    def test_delete_node_keeps_function_and_comments(self):
        source = BASE.replace('g.add_edge("work", END)', 'g.add_node("extra", extra) # preserve this too\ng.add_edge("work", "extra")\ng.add_edge("extra", END)').replace('g = StateGraph', 'def extra(state):\n    return {}\n\ng = StateGraph')
        root, graph, target = self.fixture({'graph.py': source})
        target['nodes'] = [n for n in target['nodes'] if n['id'] != 'extra']
        target['edges'] = [e for e in target['edges'] if e['from'] != 'extra' and e['to'] != 'extra']
        target['edges'].append({'id': 'finish', 'kind': 'normal', 'from': 'work', 'to': '__end__'})
        after = self.run_preview(root, graph, target)['files'][0]['after']
        self.assertIn('def extra(state):', after)
        self.assertIn('# preserve this too', after)
        self.assertNotIn('g.add_node("extra"', after)

    def test_condition_preserves_bool_and_integer_keys_and_loop(self):
        source = BASE.replace('g = StateGraph', 'def route(state):\n    return True\n\ng = StateGraph').replace('g.add_edge("work", END)', 'g.add_conditional_edges("work", route, {True: END, 7: "work"}) # route comment')
        root, graph, target = self.fixture({'graph.py': source})
        target['edges'][-1]['to'] = '__end__'
        after = self.run_preview(root, graph, target)['files'][0]['after']
        self.assertIn("{True: \"__end__\", 7: \"__end__\"}", after)
        self.assertIn('# route comment', after)
        self.assertIn('    return True', after)

    def test_join_rewrite_and_reducer_remains(self):
        path = Path(__file__).resolve().parents[3] / 'examples/parallel-team/graph.py'
        root, graph, target = self.fixture({'graph.py': path.read_bytes()})
        target['nodes'].append({'id': 'third', 'functionRef': 'analyst', 'description': ''})
        join = next(e for e in target['edges'] if e['kind'] == 'join')
        target['edges'].extend([{'id': 'start-third', 'from': '__start__', 'to': 'third', 'kind': 'normal'},
                                {'id': 'join-third', 'from': 'third', 'to': join['to'], 'kind': 'join', 'joinId': join['joinId']}])
        # All members must be rewritten if a join gains a source, not split into two joins.
        result = self.run_preview(root, graph, target)
        after = result['files'][0]['after']
        self.assertIn('Annotated[list[str], operator.add]', after)
        self.assertIn('["researcher", "analyst", "third"]', after)

    def test_encoding_bom_crlf_and_unicode_ast_columns(self):
        for encoding in ['utf-8-sig', 'gb18030']:
            with self.subTest(encoding=encoding):
                source = BASE.replace('g = StateGraph', 'def 工作(state):\n    return {}\n\ng = StateGraph').replace("g.add_node('work', work)", "g.add_node('work', 工作)")
                if encoding == 'gb18030':
                    source = '# coding: gb18030\n' + source
                root, graph, target = self.fixture({'graph.py': source.replace('\n', '\r\n').encode(encoding)})
                target['nodes'][0]['functionRef'] = 'work'
                result = self.run_preview(root, graph, target)
                self.assertEqual(result['files'][0]['encoding'], encoding)
                self.assertIn("g.add_node('work', work)  # keep registration comment\r\n", result['files'][0]['after'])
                self.assertNotIn('\n', result['files'][0]['after'].replace('\r\n', ''))

    def test_state_remove_all_fields_keeps_class_valid_and_comments(self):
        root, graph, target = self.fixture({'graph.py': BASE.replace('    """Shared schema."""\n', '')})
        target['state']['fields'] = []
        after = self.run_preview(root, graph, target)['files'][0]['after']
        self.assertIn('    pass\n    # keep field comment', after)
        self.assertIn('return {"question": state["question"]}', after)

    def test_description_only_is_behavior_requirement(self):
        root, graph, target = self.fixture()
        target['nodes'][0]['description'] = 'new behavior'
        result = self.run_preview(root, graph, target)
        self.assertEqual(result['files'], [])
        self.assertEqual(result['behaviorRequirements'][0]['description'], 'new behavior')
        self.assertTrue(result['warnings'])

    def test_rejects_dynamic_chain_alias_shared_state_and_unsafe_annotations(self):
        cases = [
            (BASE.replace('g.add_node(\'work\', work)', "g.add_node('work', work).add_edge('work', END)"), '链式'),
            (BASE.replace('app = g.compile()', 'alias = g\napp = g.compile()'), '别名'),
            (BASE.replace('app = g.compile()', 'if True:\n    g.add_edge("work", END)\napp = g.compile()'), '诊断'),
            (BASE + '\nsecond = StateGraph(State)\n', '共享'),
        ]
        for source, message in cases:
            with self.subTest(message=message):
                root, graph, target = self.fixture({'graph.py': source})
                target['state']['fields'].append({'name': 'answer', 'annotation': 'str'})
                with self.assertRaisesRegex(ValueError, message):
                    generate(root, graph['id'], graph['revision'], target)
        for annotation in ['__import__("os").system("echo NO")', 'MissingType']:
            root, graph, target = self.fixture()
            target['state']['fields'].append({'name': 'answer', 'annotation': annotation})
            with self.assertRaises(ValueError):
                generate(root, graph['id'], graph['revision'], target)

    def test_never_executes_modules_and_rejects_stale_source(self):
        root, graph, target = self.fixture({'graph.py': BASE + '\nraise RuntimeError("never execute")\n'})
        target['state']['fields'].append({'name': 'answer', 'annotation': 'str'})
        self.run_preview(root, graph, target)
        (root / 'graph.py').write_text(BASE + '# external edit', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '源码已变化'):
            generate(root, graph['id'], graph['revision'], target)

    def test_function_scope_and_other_graph_unchanged(self):
        source = BASE[:BASE.index('g = StateGraph')] + 'def build():\n' + '\n'.join('    ' + line for line in BASE[BASE.index('g = StateGraph'):].splitlines()) + '\n    return app\n\nother = StateGraph(State)\n'
        root, graph, target = self.fixture({'graph.py': source})
        target['nodes'].append({'id': 'review', 'functionRef': 'review', 'description': ''})
        target['edges'][-1]['to'] = 'review'
        target['edges'].append({'id': 'last', 'from': 'review', 'to': '__end__', 'kind': 'normal'})
        result = self.run_preview(root, graph, target)
        self.assertIn('    def review(state):', result['files'][0]['after'])
        self.assertIn('other = StateGraph(State)', result['files'][0]['after'])


if __name__ == '__main__':
    unittest.main()
