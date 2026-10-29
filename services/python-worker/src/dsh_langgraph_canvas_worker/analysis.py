"""Conservative AST analysis of explicit LangGraph construction."""
from __future__ import annotations

import ast
import hashlib
import os
import tokenize
from pathlib import Path
from .symbols import Symbols

EXCLUDED = {'venv', 'env', '__pycache__', 'node_modules', 'dist', 'build'}
MAX_FILES = 2000
MAX_BYTES = 2 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def location(file, node):
    return {'file': file, 'line': node.lineno, 'endLine': node.end_lineno,
            'column': node.col_offset}


def diagnostic(code, message, file=None, node=None, severity='warning'):
    value = {'code': code, 'severity': severity, 'message': message}
    if file and node is not None:
        value['source'] = location(file, node)
    return value


def text(node):
    return ast.unparse(node) if node is not None else ''


def arg(call, index, key):
    return call.args[index] if len(call.args) > index else next(
        (kw.value for kw in call.keywords if kw.arg == key), None)


def confined(root, relative):
    result = (root / relative).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('Path must remain within the selected project')
    return result


class Analyzer:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.modules = {}
        self.diagnostics = []
        self.hashes = {}
        self.symbols = Symbols(self)

    def module(self, file):
        if file not in self.modules:
            path = confined(self.root, file)
            raw = path.read_bytes()
            if len(raw) > MAX_BYTES:
                raise ValueError('Source file exceeds 2 MiB')
            with tokenize.open(path) as handle:
                source = handle.read()
            self.hashes[file] = digest(raw)
            self.modules[file] = (ast.parse(source, filename=file), source)
        return self.modules[file]

    def resolve(self, file, expression, scope=''):
        bound = self.symbols.binding(file, expression, scope)
        if bound and isinstance(bound['node'], (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return bound['file'], bound['node']
        return None

    def state_fields(self, file, node, seen=None):
        seen = set() if seen is None else seen
        key = (file, node.name)
        if key in seen:
            return []
        seen = seen | {key}
        fields = {}
        for base in node.bases:
            resolved = self.resolve(file, text(base))
            if resolved and isinstance(resolved[1], ast.ClassDef):
                fields.update((f['name'], f) for f in self.state_fields(*resolved, seen))
        fields.update((n.target.id, {'name': n.target.id, 'annotation': text(n.annotation)})
                      for n in node.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name))
        return list(fields.values())

    def analyze_file(self, file):
        tree, _ = self.module(file)
        imports = {}
        for entry in tree.body:
            if isinstance(entry, ast.ImportFrom):
                for alias in entry.names:
                    imports[alias.asname or alias.name] = str(entry.module) + '.' + alias.name
            elif isinstance(entry, ast.Import):
                for alias in entry.names:
                    imports[alias.asname or alias.name.split('.')[0]] = alias.name if alias.asname else alias.name.split('.')[0]

        def qualified(node, scope=''):
            bound = self.symbols.binding(file, text(node), scope)
            if bound and bound['origin']:
                return bound['origin']
            first, *rest = text(node).split('.')
            return '.'.join([imports.get(first, first)] + rest)

        def node_id(node, scope='', env=None):
            try:
                value = self.symbols.literal(file, node, scope, env)
                if isinstance(value, str):
                    return value
            except (ValueError, TypeError):
                pass
            return {'langgraph.graph.START': '__start__', 'langgraph.graph.END': '__end__',
                    'langgraph.graph.state.START': '__start__', 'langgraph.graph.state.END': '__end__'}.get(qualified(node, scope))

        graphs = []

        def process(call, builders, scope, env=None):
            env = env or {}
            identity_of = lambda node: node_id(node, scope, env)
            if not isinstance(call.func, ast.Attribute):
                return None
            receiver = call.func.value
            graph = process(receiver, builders, scope, env) if isinstance(receiver, ast.Call) else (
                builders.get(text(receiver)) if isinstance(receiver, (ast.Name, ast.Attribute)) else None)
            if graph is None:
                return None
            method = call.func.attr
            src = location(file, call)

            def warn(code, message):
                graph['diagnostics'].append(diagnostic(code, message, file, call))

            def edge(start, end, kind='normal', **extra):
                graph['edges'].append({'id': graph['id'] + ':e' + str(len(graph['edges'])),
                    'from': start, 'to': end, 'kind': kind, 'source': src, **extra})

            if method == 'add_node':
                identity, action = arg(call, 0, 'node'), arg(call, 1, 'action')
                key = identity_of(identity)
                if key is None and action is None and isinstance(identity, (ast.Name, ast.Attribute)):
                    action, key = identity, text(identity).split('.')[-1]
                if key is None:
                    warn('DYNAMIC_NODE', '节点名称无法静态确定，未展开该节点。')
                    return graph
                if any(n['id'] == key for n in graph['nodes']):
                    warn('DUPLICATE_NODE', '重复节点：' + key)
                    return graph
                action_ref = text(action)
                resolved = self.resolve(file, action_ref, scope)
                if isinstance(action, ast.Name) and action.id in env and isinstance(env[action.id], dict):
                    reference = env[action.id]
                    action_ref = reference.get('_reference', action_ref)
                    resolved = self.resolve(reference.get('_file', file), action_ref, reference.get('_scope', ''))
                node = {'id': key, 'title': key, 'kind': 'function' if resolved and isinstance(resolved[1], (ast.FunctionDef, ast.AsyncFunctionDef)) else 'unknown',
                        'execution': 'function' if resolved and isinstance(resolved[1], (ast.FunctionDef, ast.AsyncFunctionDef)) else 'unknown',
                        'functionRef': action_ref, 'registration': src}
                if resolved:
                    node['implementation'] = location(*resolved)
                    node['summary'] = ast.get_docstring(resolved[1]) or ''
                graph['nodes'].append(node)
            elif method in ('add_edge', 'set_entry_point', 'set_finish_point'):
                first, second = arg(call, 0, 'start_key'), arg(call, 1, 'end_key')
                if method == 'set_entry_point':
                    start, end = '__start__', identity_of(arg(call, 0, 'key'))
                elif method == 'set_finish_point':
                    start, end = identity_of(arg(call, 0, 'key')), '__end__'
                else:
                    start, end = identity_of(first), identity_of(second)
                if method == 'add_edge' and isinstance(first, (ast.List, ast.Tuple)):
                    starts = [identity_of(n) for n in first.elts]
                    if end is not None and starts and all(n is not None for n in starts):
                        for start in starts:
                            edge(start, end, 'join', joinId=graph['id'] + ':join:' + str(call.lineno))
                    else:
                        warn('DYNAMIC_EDGE', '汇合边端点无法静态确定。')
                elif start is not None and end is not None:
                    edge(start, end)
                else:
                    warn('DYNAMIC_EDGE', '连线端点无法静态确定。')
            elif method in ('add_conditional_edges', 'set_conditional_entry_point'):
                offset = 0 if method == 'add_conditional_edges' else -1
                start = identity_of(arg(call, 0, 'source')) if offset == 0 else '__start__'
                router = text(arg(call, 1 + offset, 'path'))
                mapping = arg(call, 2 + offset, 'path_map')
                if isinstance(mapping, (ast.Name, ast.Attribute)):
                    bound = self.symbols.binding(file, text(mapping), scope)
                    if bound and isinstance(bound['node'], (ast.Dict, ast.List, ast.Tuple)):
                        mapping = bound['node']
                if start is None:
                    warn('DYNAMIC_ROUTE', '条件分支起点无法静态确定。')
                elif isinstance(mapping, ast.Dict):
                    for label, target in zip(mapping.keys, mapping.values):
                        end = identity_of(target)
                        try:
                            branch = self.symbols.literal(file, label, scope, env)
                        except (ValueError, TypeError):
                            branch = None
                        if isinstance(branch, (str, int, bool)) and end is not None:
                            edge(start, end, 'conditional', label=str(branch), route=router)
                        else:
                            warn('DYNAMIC_ROUTE', '部分条件路径映射无法静态确定。')
                elif isinstance(mapping, (ast.List, ast.Tuple)):
                    for target in mapping.elts:
                        end = identity_of(target)
                        if end is None:
                            warn('DYNAMIC_ROUTE', '部分条件路径无法静态确定。')
                        else:
                            edge(start, end, 'conditional', label=end, route=router)
                else:
                    warn('DYNAMIC_ROUTE', '没有字面量路径映射，不推断动态目的地。')
            elif method not in ('compile', 'validate'):
                warn('UNSUPPORTED_OPERATION', '未解析构图操作：' + method)
            if method in ('add_conditional_edges', 'set_conditional_entry_point'):
                router_node = self.resolve(file, router, scope)
                if router_node:
                    for registered_edge in graph['edges']:
                        if registered_edge['source'] == src and registered_edge.get('route') == router:
                            registered_edge['routerSource'] = location(*router_node)
            return graph

        def scope_body(body, scope='', builders=None, env=None):
            builders = {} if builders is None else builders
            env = env or {}
            for statement in body:
                if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    scope_body(statement.body, '.'.join(filter(None, [scope, statement.name])))
                    continue
                targets = statement.targets if isinstance(statement, ast.Assign) else (
                    [statement.target] if isinstance(statement, ast.AnnAssign) else [])
                value = getattr(statement, 'value', None)
                if isinstance(value, ast.Call) and qualified(value.func, scope) in (
                        'langgraph.graph.StateGraph', 'langgraph.graph.state.StateGraph'):
                    if len(targets) != 1 or not isinstance(targets[0], ast.Name):
                        self.diagnostics.append(diagnostic('DYNAMIC_BUILDER', '不支持的构建器赋值。', file, statement))
                        continue
                    symbol = targets[0].id
                    state = text(arg(value, 0, 'state_schema'))
                    resolved = self.resolve(file, state, scope)
                    fields = []
                    if resolved and isinstance(resolved[1], ast.ClassDef):
                        fields = self.state_fields(*resolved)
                    full = scope + '.' + symbol if scope else symbol
                    graph = {'schemaVersion': 1, 'id': file + '::' + full, 'title': full,
                             'file': file, 'symbol': symbol, 'scope': scope, 'revision': '',
                             'state': {'reference': state, 'fields': fields},
                             'nodes': [], 'edges': [], 'diagnostics': [],
                             'capabilities': {'structuralEdit': False, 'sourceRead': True}}
                    if resolved and isinstance(resolved[1], ast.ClassDef):
                        graph['state']['source'] = location(*resolved)
                    if symbol in builders:
                        builders[symbol]['diagnostics'].append(diagnostic('BUILDER_REASSIGNED',
                            '同名构建器重新赋值，旧实例仅显示已识别部分。', file, statement))
                        graph['id'] += ':' + str(statement.lineno)
                    builders[symbol] = graph
                    graphs.append(graph)
                    continue
                if isinstance(value, ast.Name) and value.id in builders:
                    for target in targets:
                        if isinstance(target, ast.Name):
                            builders[target.id] = builders[value.id]
                if isinstance(value, ast.Call):
                    process(value, builders, scope, env)
                if isinstance(statement, ast.For):
                    try:
                        iterator = statement.iter
                        if isinstance(iterator, ast.Call) and isinstance(iterator.func, ast.Attribute) and iterator.func.attr == 'items' and not iterator.args and not iterator.keywords:
                            registry = self.symbols.literal(file, iterator.func.value, scope, env)
                            if not isinstance(registry, dict):
                                raise ValueError()
                            values = list(registry.items())
                        else:
                            values = self.symbols.literal(file, iterator, scope, env)
                        if not isinstance(values, (list, tuple)) or len(values) > 128 or statement.orelse:
                            raise ValueError()
                        # Only direct registration statements: no general loop interpreter.
                        if any(not isinstance(n, ast.Expr) or not isinstance(n.value, ast.Call) or not isinstance(n.value.func, ast.Attribute)
                               or text(n.value.func.value) not in builders or n.value.func.attr not in ('add_node', 'add_edge', 'add_conditional_edges') for n in statement.body):
                            raise ValueError()
                        names = [statement.target.id] if isinstance(statement.target, ast.Name) else [n.id for n in statement.target.elts if isinstance(n, ast.Name)]
                        for value in values:
                            row = [value] if isinstance(statement.target, ast.Name) else list(value)
                            if len(names) != len(row):
                                raise ValueError()
                            local = {**env, **dict(zip(names, row))}
                            for item in statement.body:
                                target = process(item.value, builders, scope, local)
                                if target:
                                    target['_readOnly'] = '节点／边来自静态注册表展开，当前确定性写回器不修改此类注册表。'
                        continue
                    except (ValueError, TypeError, AttributeError):
                        pass
                if isinstance(value, ast.Call):
                    for item in [*value.args, *(kw.value for kw in value.keywords)]:
                        if isinstance(item, ast.Name) and item.id in builders:
                            builders[item.id]['diagnostics'].append(diagnostic('CROSS_FUNCTION_BUILDER', '构建器传入辅助函数；该函数内部构图尚需深度解析。', file, value))
                if isinstance(statement, (ast.For, ast.AsyncFor, ast.While, ast.If, ast.Try, ast.With, ast.AsyncWith, ast.Match)):
                    for item in ast.walk(statement):
                        if isinstance(item, ast.Call) and isinstance(item.func, ast.Attribute):
                            if item.func.attr in ('add_node', 'add_edge', 'add_conditional_edges'):
                                receiver = item.func.value
                                target = builders.get(receiver.id) if isinstance(receiver, ast.Name) else None
                                warn = diagnostic('DYNAMIC_CONTROL_FLOW',
                                    '控制流中的构图调用未展开，图可能不完整。', file, item)
                                (target['diagnostics'] if target is not None else self.diagnostics).append(warn)
        scope_body(tree.body)
        for graph in graphs:
            known = {n['id'] for n in graph['nodes']}
            endpoints = {e[key] for e in graph['edges'] for key in ('from', 'to')}
            for boundary, title in [('__start__', '开始'), ('__end__', '结束')]:
                if boundary in endpoints:
                    graph['nodes'].append({'id': boundary, 'title': title, 'kind': 'boundary'})
                    known.add(boundary)
            for missing in sorted(endpoints - known):
                graph['nodes'].append({'id': missing, 'title': missing, 'kind': 'unknown'})
                graph['diagnostics'].append(diagnostic('UNRESOLVED_NODE', '连线引用未解析节点：' + missing))
        for graph in graphs:
            reference = any(p.lower() in {'docs', 'doc', 'examples', 'example', 'tests', 'test', 'archive'} for p in Path(file).parts[:-1])
            graph['discovery'] = {'method': 'static', 'category': 'reference' if reference else 'project',
                                  'completeness': 'partial' if graph['diagnostics'] else 'static',
                                  'readOnly': bool(graph['diagnostics'] or graph.get('_readOnly')),
                                  'reason': graph.pop('_readOnly', '')}
        return graphs

    def inventory(self):
        files = []
        reference = {'docs', 'doc', 'examples', 'example', 'tests', 'test', 'archive'}
        for directory, dirs, names in os.walk(self.root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not d.startswith('.')
                             and not Path(directory, d).is_symlink())
            for name in sorted(names):
                path = Path(directory, name)
                if name.endswith('.py') and not path.is_symlink():
                    files.append(path.relative_to(self.root).as_posix())
        files.sort(key=lambda file: (any(p.lower() in reference for p in Path(file).parts[:-1]), file))
        return files[:MAX_FILES], len(files) > MAX_FILES

    def scan(self):
        files, truncated = self.inventory()
        graphs = []
        for file in files:
            try:
                graphs.extend(self.analyze_file(file))
            except SyntaxError as exc:
                self.diagnostics.append({'code': 'SYNTAX_ERROR', 'severity': 'error',
                    'message': str(exc), 'source': {'file': file, 'line': exc.lineno or 1,
                    'endLine': exc.lineno or 1, 'column': max(0, (exc.offset or 1) - 1)}})
            except (OSError, UnicodeError, ValueError) as exc:
                self.diagnostics.append(diagnostic('READ_ERROR', file + ': ' + str(exc), severity='error'))
        if truncated:
            self.diagnostics.append(diagnostic('SCAN_LIMIT', '达到 2000 个 Python 文件扫描上限；优先扫描业务源码，结果可能不完整。'))
        graphs.sort(key=lambda g: (g['discovery']['category'] == 'reference', g['file'], g['id']))
        if not any(g['discovery']['category'] == 'project' for g in graphs):
            self.diagnostics.append(diagnostic('NO_PROJECT_GRAPH', '未识别到业务图；文档／示例图默认隐藏，可使用 AI 深度解析并核对当前工作区目录。'))
        revision = digest('\n'.join(k + ':' + v for k, v in sorted(self.hashes.items())).encode())
        for graph in graphs:
            graph['revision'] = revision
        return {'schemaVersion': 1, 'graphs': graphs, 'diagnostics': self.diagnostics,
                'revision': revision, 'scannedFiles': len(files),
                'scan': {'root': str(self.root), 'files': files, 'limitReached': truncated,
                         'projectGraphCount': sum(g['discovery']['category'] == 'project' for g in graphs),
                         'referenceGraphCount': sum(g['discovery']['category'] == 'reference' for g in graphs)}}
