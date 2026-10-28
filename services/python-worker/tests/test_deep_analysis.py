import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from langcontour_worker import deep_analysis as deep
from langcontour_worker.analysis import Analyzer


class DeepAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'state.py').write_text('from typing import TypedDict\nclass State(TypedDict):\n    question: str\n', encoding='utf-8')
        (self.root / 'nodes.py').write_text('raise RuntimeError("never execute")\ndef work(s):\n    return s\n', encoding='utf-8')
        (self.root / 'graph.py').write_text('from langgraph.graph import StateGraph\nfrom state import State\nfrom nodes import work\ng=StateGraph(State)\ndef register(builder):\n    builder.add_node("work", work)\nregister(g)\n', encoding='utf-8')
        (self.root / 'docs').mkdir()
        (self.root / 'docs' / 'demo.py').write_text('from langgraph.graph import StateGraph\ng=StateGraph(dict)\n', encoding='utf-8')
        self.ctx = deep.context(self.root)
        self.evidence = [deep.read_source(self.root, {'file': f['file'], 'line': 1, 'endLine': f['lines']}, self.ctx['files']) for f in self.ctx['files']]

    def loc(self, file, line, end=None):
        return {'file': file, 'line': line, 'endLine': end or line}

    def payload(self):
        return {'graphs': [{'file': 'graph.py', 'symbol': 'g', 'scope': '', 'source': self.loc('graph.py', 4),
            'state': {'reference': 'State', 'source': self.loc('state.py', 2, 3), 'fields': [
                {'name': 'question', 'annotation': 'str', 'source': self.loc('state.py', 3)}]},
            'nodes': [{'id': 'work', 'functionRef': 'work', 'registration': self.loc('graph.py', 6), 'implementation': self.loc('nodes.py', 2, 3)}],
            'edges': []}], 'message': '跨文件读取完成'}

    def validate(self, value=None, evidence=None):
        return deep.validate(self.root, value or self.payload(), self.ctx['revision'], self.evidence if evidence is None else evidence)

    def test_context_excludes_docs_and_does_not_execute_modules(self):
        self.assertEqual({f['file'] for f in self.ctx['files']}, {'graph.py', 'state.py', 'nodes.py'})
        self.assertTrue(self.ctx['staticGraphs'][0]['discovery']['readOnly'])
        self.assertFalse((self.root / '.vislang').exists())

    def test_evidence_checked_result_forced_readonly_and_cached_by_revision(self):
        original = {p.name: p.read_bytes() for p in self.root.glob('*.py')}
        value = self.payload()
        value['graphs'][0]['capabilities'] = {'structuralEdit': True}
        validated = self.validate(value)
        graph = validated['graphs'][0]
        self.assertEqual(graph['id'], 'graph.py::g')
        self.assertEqual(graph['discovery']['method'], 'ai')
        self.assertTrue(graph['discovery']['readOnly'])
        self.assertFalse(graph['capabilities']['structuralEdit'])
        deep.store(self.root, validated)
        self.assertEqual(deep.cached(self.root, self.ctx['revision'])['graphs'][0]['nodes'][0]['implementation']['file'], 'nodes.py')
        self.assertEqual(original, {p.name: p.read_bytes() for p in self.root.glob('*.py')})
        (self.root / 'nodes.py').write_text('def work(s): return {}\n', encoding='utf-8')
        self.assertIsNone(deep.cached(self.root, Analyzer(self.root).scan()['revision']))
        with self.assertRaisesRegex(ValueError, '源码已变化'):
            deep.store(self.root, validated)

    def test_unread_fabricated_reference_and_out_of_range_evidence_rejected(self):
        with self.assertRaisesRegex(ValueError, '必须先读取'):
            self.validate(evidence=[])
        for file, line in [('docs/demo.py', 1), ('../outside.py', 1), ('nodes.py', 1000)]:
            value = self.payload()
            value['graphs'][0]['nodes'][0]['implementation'] = self.loc(file, line)
            with self.assertRaises(ValueError):
                self.validate(value)

    def test_reads_confined_versioned_and_bounded(self):
        for request in [{'file': '../state.py'}, {'file': 'docs/demo.py'}, {'file': 'graph.py', 'line': 0},
                        {'file': 'graph.py', 'line': True}, {'file': 'graph.py', 'line': 1, 'endLine': 301}]:
            with self.assertRaises(ValueError):
                deep.read_source(self.root, request, self.ctx['files'])
        (self.root / 'graph.py').write_text('# changed\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '源码已变化'):
            deep.read_source(self.root, {'file': 'graph.py'}, self.ctx['files'])

    def test_citation_can_span_adjacent_or_overlapping_current_reads(self):
        other = [item for item in self.evidence if item['file'] != 'nodes.py']
        for spans in [[(1, 2), (3, 3)], [(1, 2), (2, 3)]]:
            supplied = other + [deep.read_source(self.root, self.loc('nodes.py', start, end), self.ctx['files']) for start, end in spans]
            self.assertEqual(self.validate(evidence=supplied)['graphs'][0]['nodes'][0]['implementation'],
                             {**self.loc('nodes.py', 2, 3), 'column': 0})

    def test_evidence_union_never_bridges_unread_lines_or_old_versions(self):
        other = [item for item in self.evidence if item['file'] != 'nodes.py']
        first = deep.read_source(self.root, self.loc('nodes.py', 1), self.ctx['files'])
        last = deep.read_source(self.root, self.loc('nodes.py', 3), self.ctx['files'])
        with self.assertRaisesRegex(ValueError, r'nodes.py:2–3'):
            self.validate(evidence=other + [first, last])
        second = deep.read_source(self.root, self.loc('nodes.py', 2), self.ctx['files'])
        last['hash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, '本次该文件已读取'):
            self.validate(evidence=other + [first, second, last])

    def test_invalid_endpoints_malformed_nodes_and_incomplete_join_rejected(self):
        for mutation in ['endpoint', 'join', 'node', 'field']:
            value = self.payload()
            graph = value['graphs'][0]
            if mutation in ('endpoint', 'join'):
                graph['edges'] = [{'from': 'work', 'to': 'missing' if mutation == 'endpoint' else 'work', 'kind': 'normal' if mutation == 'endpoint' else 'join', 'joinId': 'group', 'source': self.loc('graph.py', 6)}]
            elif mutation == 'node':
                graph['nodes'] = [None]
            else:
                graph['state']['fields'] = [None]
            with self.assertRaises(ValueError):
                self.validate(value)

    def test_broken_or_tampered_cache_falls_back(self):
        deep.store(self.root, self.validate())
        path = deep.cache_path(self.root)
        record = json.loads(path.read_text(encoding='utf-8'))
        record['data']['graphs'][0]['nodes'][0]['id'] = 'tampered'
        path.write_text(json.dumps(record), encoding='utf-8')
        self.assertIsNone(deep.cached(self.root, self.ctx['revision']))
        path.write_text('{broken', encoding='utf-8')
        self.assertIsNone(deep.cached(self.root, self.ctx['revision']))
