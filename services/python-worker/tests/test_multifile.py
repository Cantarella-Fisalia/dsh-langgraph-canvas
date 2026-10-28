import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from dsh_langgraph_canvas_worker.analysis import Analyzer
from dsh_langgraph_canvas_worker.source_preview import generate


class MultiFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, file, content):
        path = self.root / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def test_reexports_try_constants_registry_state_and_reference_order(self):
        self.put('backend/__init__.py', '')
        self.put('backend/workflows/__init__.py', '')
        self.put('backend/workflows/runtime.py', '''try:
    from langgraph.graph import StateGraph, START, END
except Exception:
    StateGraph = None
    START = '__start__'
    END = '__end__'
''')
        self.put('backend/workflows/base.py', 'from typing import TypedDict\nclass Base(TypedDict):\n    question: str\n')
        self.put('backend/workflows/state.py', 'from .base import Base\nclass State(Base):\n    answer: str\n')
        self.put('backend/workflows/nodes.py', 'raise RuntimeError("never execute")\ndef worker(s):\n    """处理问题"""\n    return s\n')
        self.put('backend/workflows/exports.py', 'from .runtime import StateGraph, START, END\n')
        self.put('backend/workflows/main.py', '''from .exports import StateGraph, START, END
from .state import State
from .nodes import worker
WORK = 'worker'
NODES = {WORK: worker}
def build():
    graph = StateGraph(State)
    for name, fn in NODES.items():
        graph.add_node(name, fn)
    graph.add_edge(START, WORK)
    graph.add_conditional_edges(WORK, router, {'again': WORK, 'done': END})
    return graph.compile()
''')
        self.put('docs/examples/demo.py', 'from langgraph.graph import StateGraph\ndemo=StateGraph(dict)\n')
        result = Analyzer(self.root).scan()
        self.assertEqual(result['scan']['projectGraphCount'], 1)
        self.assertEqual(result['scan']['referenceGraphCount'], 1)
        graph = result['graphs'][0]
        self.assertEqual(graph['id'], 'backend/workflows/main.py::build.graph')
        self.assertEqual(graph['diagnostics'], [])
        self.assertEqual({f['name'] for f in graph['state']['fields']}, {'question', 'answer'})
        node = next(n for n in graph['nodes'] if n['id'] == 'worker')
        self.assertEqual(node['functionRef'], 'worker')
        self.assertEqual(node['implementation']['file'], 'backend/workflows/nodes.py')
        self.assertEqual({(e['from'], e['to']) for e in graph['edges']}, {('__start__', 'worker'), ('worker', 'worker'), ('worker', '__end__')})
        self.assertTrue(graph['discovery']['readOnly'])
        self.assertEqual(result['graphs'][-1]['discovery']['category'], 'reference')
        with self.assertRaises(ValueError):
            generate(self.root, graph['id'], graph['revision'], graph)

    def test_module_attribute_reexports_and_import_cycles_terminate(self):
        self.put('runtime.py', 'from langgraph.graph import StateGraph\n')
        self.put('main.py', 'import runtime as rt\ng=rt.StateGraph(dict)\n')
        self.put('a.py', 'from b import Other\n')
        self.put('b.py', 'from a import Other\n')
        self.put('unrelated.py', 'from a import Other\nx=Other(dict)\n')
        result = Analyzer(self.root).scan()
        self.assertEqual([g['id'] for g in result['graphs']], ['main.py::g'])

    def test_only_reference_graphs_are_reported_as_no_business_graph(self):
        self.put('docs/demo.py', 'from langgraph.graph import StateGraph\ng=StateGraph(dict)\n')
        result = Analyzer(self.root).scan()
        self.assertEqual(result['scan']['projectGraphCount'], 0)
        self.assertIn('NO_PROJECT_GRAPH', {d['code'] for d in result['diagnostics']})

    def test_builder_helper_remains_partial_instead_of_silent_complete(self):
        for helper in ['register(g)', 'module.register(g)', 'register(graph=g)']:
            self.put('main.py', 'def build():\n    from langgraph.graph import StateGraph\n    g=StateGraph(dict)\n    ' + helper + '\n')
            graph = Analyzer(self.root).scan()['graphs'][0]
            self.assertEqual(graph['discovery']['completeness'], 'partial')
            self.assertTrue(graph['discovery']['readOnly'])
            self.assertIn('CROSS_FUNCTION_BUILDER', {d['code'] for d in graph['diagnostics']})
