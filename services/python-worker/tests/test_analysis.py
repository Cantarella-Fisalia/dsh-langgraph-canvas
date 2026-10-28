import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from dsh_langgraph_canvas_worker.analysis import Analyzer, confined


class AnalysisTests(unittest.TestCase):
    def analyze(self, files):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')
            return Analyzer(root).scan()

    def test_real_example_cross_file_and_loop(self):
        root = Path(__file__).resolve().parents[3] / 'examples/research-team'
        result = Analyzer(root).scan()
        self.assertEqual(len(result['graphs']), 1)
        graph = result['graphs'][0]
        self.assertEqual(graph['id'], 'graph.py::builder')
        self.assertEqual(len(graph['nodes']), 5)
        self.assertEqual(len(graph['edges']), 5)
        node = next(n for n in graph['nodes'] if n['id'] == 'writer')
        self.assertEqual(node['implementation']['file'], 'nodes.py')
        self.assertIn('撰写', node['summary'])
        self.assertEqual(len(graph['state']['fields']), 5)
        self.assertTrue(any(e['from'] == 'reviewer' and e['to'] == 'writer' for e in graph['edges']))
        self.assertEqual(result['diagnostics'], [])

    def test_never_imports_or_executes_user_source(self):
        result = self.analyze({'graph.py': '''
raise RuntimeError("must never run")
from langgraph.graph import StateGraph, START, END
g = StateGraph(dict)
g.add_node("n", unknown_callable)
g.add_edge(START, "n")
g.add_edge("n", END)
'''})
        self.assertEqual(len(result['graphs']), 1)

    def test_scopes_aliases_chains_and_join(self):
        result = self.analyze({'graph.py': '''
from langgraph.graph import StateGraph as SG, START as S, END as E
def build():
    g = SG(dict)
    alias = g
    alias.add_node("a", a).add_node("b", b).add_node("c", c)
    g.add_edge(S, "a")
    g.add_edge(S, "b")
    g.add_edge(["a", "b"], "c")
    g.set_finish_point("c")
    return g.compile()
'''})
        graph = result['graphs'][0]
        self.assertEqual(graph['id'], 'graph.py::build.g')
        joins = [e for e in graph['edges'] if e['kind'] == 'join']
        self.assertEqual(len(joins), 2)
        self.assertEqual(joins[0]['joinId'], joins[1]['joinId'])

    def test_dynamic_routes_are_diagnosed_not_invented(self):
        result = self.analyze({'graph.py': '''
from langgraph.graph import StateGraph
g = StateGraph(dict)
for name in names:
    g.add_node(name, handler)
g.add_conditional_edges("a", router)
'''})
        graph = result['graphs'][0]
        codes = {d['code'] for d in graph['diagnostics']}
        self.assertTrue({'DYNAMIC_CONTROL_FLOW', 'DYNAMIC_ROUTE'} <= codes)
        self.assertEqual(graph['edges'], [])

    def test_syntax_error_and_revision(self):
        result = self.analyze({'bad.py': 'def invalid(: pass'})
        self.assertEqual(result['diagnostics'][0]['code'], 'SYNTAX_ERROR')
        self.assertNotEqual(result['revision'], self.analyze({'bad.py': 'def bad(: x'})['revision'])

    def test_relative_import_resolution(self):
        result = self.analyze({'team/__init__.py': '', 'team/nodes.py': 'def worker(s): return s',
            'team/graph.py': 'from langgraph.graph import StateGraph\nfrom .nodes import worker\ng=StateGraph(dict)\ng.add_node(worker)'})
        self.assertEqual(result['graphs'][0]['nodes'][0]['implementation']['file'], 'team/nodes.py')

    def test_confines_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                confined(Path(directory), '../outside.py')

    def test_ignores_non_langgraph_builder(self):
        result = self.analyze({'graph.py': 'from another import StateGraph\ng=StateGraph(dict)\ng.add_node("x", f)'})
        self.assertEqual(result['graphs'], [])

    def test_parallel_and_router_examples(self):
        examples = Path(__file__).resolve().parents[3] / 'examples'
        parallel = Analyzer(examples / 'parallel-team').scan()['graphs'][0]
        self.assertEqual(len([e for e in parallel['edges'] if e['kind'] == 'join']), 2)
        router = Analyzer(examples / 'router-team').scan()['graphs'][0]
        self.assertEqual({e['label'] for e in router['edges'] if e['kind'] == 'conditional'}, {'support', 'research'})


if __name__ == '__main__':
    unittest.main()
