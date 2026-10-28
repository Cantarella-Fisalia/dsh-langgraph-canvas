"""Static, conservative edits in an owned temporary Python-only snapshot.

User modules are never imported. Untouched source is retained byte-for-byte.
"""
from __future__ import annotations

import ast
import base64
import difflib
import builtins
import io
import json
import keyword
import tempfile
import tokenize
from collections import defaultdict
from pathlib import Path

from .analysis import Analyzer, arg, confined, digest, text


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Source:
    def __init__(self, raw):
        self.raw = raw
        self.encoding = tokenize.detect_encoding(io.BytesIO(raw).readline)[0]
        self.content = raw.decode(self.encoding)
        self.lines = self.content.splitlines(keepends=True)
        self.tree = ast.parse(self.content)
        self.newline = '\r\n' if '\r\n' in self.content else '\n'
        self.edits = []

    def offset(self, line, column):
        # AST columns are UTF-8 bytes, including for non-UTF-8 source files.
        return sum(map(len, self.lines[:line - 1])) + len(self.lines[line - 1].encode('utf-8')[:column].decode('utf-8'))

    def replace(self, node, value):
        start, end = self.offset(node.lineno, node.col_offset), self.offset(node.end_lineno, node.end_col_offset)
        for tok in tokenize.generate_tokens(io.StringIO(self.content).readline):
            point = sum(map(len, self.lines[:tok.start[0] - 1])) + tok.start[1]
            require(tok.type != tokenize.COMMENT or not start <= point < end, '待替换表达式中含注释，请先整理为简单表达式。')
        self.edits.append((start, end, value))

    def insert(self, line, value):
        point = sum(map(len, self.lines[:line - 1]))
        self.edits.append((point, point, value))

    def statement(self, node):
        line = self.lines[node.lineno - 1]
        indent = line[:len(line) - len(line.lstrip(' \t'))]
        require(self.offset(node.lineno, node.col_offset) == sum(map(len, self.lines[:node.lineno - 1])) + len(indent),
                '不支持同一行中的分号语句或内联构图。')
        trailing = self.lines[node.end_lineno - 1][len(self.lines[node.end_lineno - 1].encode('utf-8')[:node.end_col_offset].decode('utf-8')):]
        require(not trailing.strip() or trailing.lstrip().startswith('#'), '不支持同一行中的多个语句。')
        return indent

    def remove(self, node):
        self.statement(node)
        segment = ''.join(self.lines[node.lineno - 1:node.end_lineno])
        # Comments are not silently deleted along with a registration or field.
        comments = [tok.string for tok in tokenize.generate_tokens(io.StringIO(segment.lstrip(' \t')).readline)
                    if tok.type == tokenize.COMMENT]
        indent = self.lines[node.lineno - 1][:len(self.lines[node.lineno - 1]) - len(self.lines[node.lineno - 1].lstrip(' \t'))]
        self.edits.append((sum(map(len, self.lines[:node.lineno - 1])),
                           sum(map(len, self.lines[:node.end_lineno])),
                           ''.join(indent + c + self.newline for c in comments)))

    def render(self):
        if not self.edits:
            return self.raw
        result = self.content
        boundary = len(result) + 1
        for start, end, replacement in sorted(self.edits, key=lambda e: (e[0], e[1]), reverse=True):
            require(end <= boundary, '源码修改范围重叠，请拆分草稿。')
            result = result[:start] + replacement + result[end:]
            boundary = start
        ast.parse(result)
        return result.encode(self.encoding)


def shape(graph, target=False):
    nodes = sorted((n['id'], n.get('functionRef') or '') for n in graph['nodes']
                   if n['id'] not in ('__start__', '__end__'))
    # Join IDs and edge IDs are source locations, not executable semantics.
    joins = defaultdict(list)
    edges = []
    for edge in graph['edges']:
        if edge['kind'] == 'join':
            joins[edge['joinId']].append(edge)
        else:
            edges.append((edge['kind'], edge['from'], edge['to'], edge.get('label', ''), edge.get('route', '')))
    for group in joins.values():
        edges.append(('join', tuple(sorted(e['from'] for e in group)), group[0]['to'], '', ''))
    fields = sorted((f['name'], ast.dump(ast.parse(f['annotation'], mode='eval').body)) for f in graph['state']['fields'])
    return {'nodes': nodes, 'edges': sorted(edges, key=repr), 'state': (graph['state']['reference'], fields)}


def identifier(value):
    return isinstance(value, str) and value.isidentifier() and not keyword.iskeyword(value)


def reference(value):
    require(isinstance(value, str) and all(identifier(part) for part in value.split('.')), '函数引用必须为 Python 名称或点分名称。')
    return value


def unified(before, after, first, second):
    lines = difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True), fromfile=first, tofile=second)
    return ''.join(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n' for line in lines)


def generate(root, graph_id, base_revision, target, include_bytes=False):
    analyzer = Analyzer(root)
    original = analyzer.scan()
    require(original['revision'] == base_revision, '源码已变化，请重新读取后确认。')
    graph = next((g for g in original['graphs'] if g['id'] == graph_id), None)
    require(graph is not None, '所选图不存在。')
    require(not graph['diagnostics'] and not original['diagnostics'], '存在解析诊断，无法安全确定完整结构；请先处理动态或未解析写法。')
    require(not graph.get('discovery', {}).get('readOnly'), graph.get('discovery', {}).get('reason', '当前结构只读，尚不能可靠修改源码。'))
    require(target['state']['reference'] == graph['state']['reference'], '本阶段不替换 State schema 引用。')
    sources = {file: Source(confined(Path(root), file).read_bytes()) for file in analyzer.hashes}
    require(sum(len(s.raw) for s in sources.values()) <= 16 * 1024 * 1024, '静态源码副本超过 16 MiB。')
    require(all(digest(s.raw) == analyzer.hashes[file] for file, s in sources.items()), '读取期间源码已变化。')
    src = sources[graph['file']]
    body = src.tree.body
    for scope in graph['scope'].split('.') if graph['scope'] else []:
        body = next(n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == scope).body
    builder = next((n for n in body if isinstance(n, (ast.Assign, ast.AnnAssign)) and
                    any(isinstance(t, ast.Name) and t.id == graph['symbol'] for t in (n.targets if isinstance(n, ast.Assign) else [n.target])) and
                    isinstance(n.value, ast.Call) and text(n.value.func).split('.')[-1] == 'StateGraph'), None)
    require(builder is not None, '只支持直接赋值的 StateGraph 构建器。')
    indent = src.statement(builder)
    parents = {child: parent for parent in ast.walk(src.tree) for child in ast.iter_child_nodes(parent)}
    locations = {(n.lineno, n.col_offset): n for n in ast.walk(src.tree) if isinstance(n, ast.Call)}
    registrations = []
    for item in graph['nodes'] + graph['edges']:
        loc = item.get('registration') or item.get('source')
        if loc and loc not in registrations:
            registrations.append(loc)
    statements = []
    for loc in registrations:
        call = locations[(loc['line'], loc['column'])]
        statement = parents.get(call)
        require(isinstance(statement, ast.Expr) and statement in body and isinstance(call.func.value, ast.Name)
                and call.func.value.id == graph['symbol'], '暂不支持链式调用、构建器别名或嵌套构图。')
        src.statement(statement)
        statements.append(statement)
    # Reject aliases, passing the builder to helpers, and graph mutations outside known calls.
    for statement in body:
        for item in ast.walk(statement):
            if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id == graph['symbol']:
                parent = parents.get(item)
                require(isinstance(parent, ast.Attribute) and isinstance(parents.get(parent), ast.Call),
                        '构建器被传递或取别名，不能安全修改。')
                require(parent.attr in {'add_node', 'add_edge', 'set_entry_point', 'set_finish_point', 'add_conditional_edges',
                                        'set_conditional_entry_point', 'compile', 'validate'}, '构建器存在不支持的调用。')
    insertion = max([builder.end_lineno] + [n.end_lineno for n in statements]) + 1
    # If compile/validate occurs before the last registration, generating here would be misleading.
    for statement in body:
        for call in ast.walk(statement):
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id == graph['symbol'] and call.func.attr in ('compile', 'validate'):
                require(call.lineno >= insertion, '构图完成前已 compile/validate，暂不支持修改。')
    added_lines, definitions, warnings, placeholders = [], [], [], []
    quote = lambda value: json.dumps(value, ensure_ascii=False)
    endpoint = quote  # LangGraph accepts literal '__start__' / '__end__', independent of import aliases.
    old_nodes = {n['id']: n for n in graph['nodes'] if n['kind'] != 'boundary'}
    new_nodes = {n['id']: n for n in target['nodes'] if n['id'] not in ('__start__', '__end__')}
    needed = {n['functionRef'] for n in new_nodes.values()}
    needed.update(e['route'] for e in target['edges'] if e['kind'] == 'conditional')
    bound = {n.id for n in ast.walk(src.tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    bound.update(n.name for n in ast.walk(src.tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)))
    bound.update(a.asname or a.name.split('.')[0] for n in ast.walk(src.tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names)
    for ref in sorted(needed):
        reference(ref)
        resolved = analyzer.resolve(graph['file'], ref, graph['scope'])
        if resolved:
            require(isinstance(resolved[1], (ast.FunctionDef, ast.AsyncFunctionDef)), '函数引用必须指向可解析的函数：' + ref)
            if resolved[0] == graph['file'] and resolved[1].lineno >= builder.lineno:
                require(False, '函数必须在构图前定义：' + ref)
            continue
        require('.' not in ref and ref not in bound and ref not in dir(builtins), '函数引用无法确定，不能覆盖已有符号或生成外部模块：' + ref)
        descriptions = [n.get('description', '') for n in new_nodes.values() if n['functionRef'] == ref]
        description = '\n'.join(d for d in descriptions if d) or '待实现的 LangGraph 路由函数。'
        definitions.append(indent + 'def ' + ref + '(state):' + src.newline + indent + '    ' + quote(description) + src.newline +
                           indent + '    raise NotImplementedError(' + quote('langcontour: implement ' + ref) + ')' + src.newline + src.newline)
        placeholders.append(ref)
    for identity, old in old_nodes.items():
        require(old.get('registration'), '存在未注册的节点，无法修改。')
        loc = old['registration']; call = locations[(loc['line'], loc['column'])]
        if identity not in new_nodes:
            src.remove(parents[call])
            continue
        new = new_nodes[identity]
        if old.get('functionRef') != new['functionRef']:
            action = arg(call, 1, 'action')
            require(action is not None, '单参数 add_node 暂不支持替换函数，请先使用显式名称注册。')
            src.replace(action, new['functionRef'])
        if new.get('description', '') != old.get('summary', ''):
            warnings.append('节点 ' + identity + ' 的职责变化仅作为后续 Harness 实现要求，既有函数体和 docstring 保留。')
    for identity, node in new_nodes.items():
        if identity not in old_nodes:
            added_lines.append(graph['symbol'] + '.add_node(' + quote(identity) + ', ' + reference(node['functionRef']) + ')')

    def edge_key(edge):
        return tuple(edge.get(k, '') for k in ('kind', 'from', 'to', 'label', 'route', 'joinId'))

    old_groups = defaultdict(list)
    for edge in graph['edges']:
        old_groups[(edge['source']['line'], edge['source']['column'])].append(edge)
    desired = list(target['edges'])
    retained = set()
    typed_labels = {}
    typed_ids = {}
    route_calls = set()
    for point, group in old_groups.items():
        ids = {e['id'] for e in group}
        remaining = [e for e in desired if e['id'] in ids]
        if group[0]['kind'] == 'join':
            remaining = [e for e in desired if e['kind'] == 'join' and e['joinId'] == group[0]['joinId']]
        if group[0]['kind'] == 'conditional':
            route_key = (group[0]['from'], group[0]['route'])
            require(route_key not in route_calls, '同一路由被多次注册，暂不支持重写。')
            route_calls.add(route_key)
            remaining = [e for e in desired if (e['from'], e.get('route')) == route_key and e['kind'] == 'conditional']
        call = locations[point]
        if group[0]['kind'] == 'conditional':
            mapping = arg(call, 2 if call.func.attr == 'add_conditional_edges' else 1, 'path_map')
            if isinstance(mapping, ast.Dict):
                for key in mapping.keys:
                    label = str(key.value)
                    index = (group[0]['from'], group[0]['route'], label)
                    require(index not in typed_labels or type(typed_labels[index]) is type(key.value), '分支文本对应多种 Python 字面量类型，暂不支持。')
                    typed_labels[index] = key.value
                    for edge in group:
                        if edge['label'] == label:
                            typed_ids[edge['id']] = (label, key.value)
        if sorted(map(edge_key, group)) == sorted(map(edge_key, remaining)):
            retained.update(ids)
        else:
            require(not any(kw.arg not in {'source', 'path', 'path_map', 'start_key', 'end_key', 'key'} for kw in call.keywords),
                    '待修改连线含额外参数，暂不支持重写。')
            src.remove(parents[call])
    pending = [e for e in desired if e['id'] not in retained]
    groups = defaultdict(list)
    for edge in pending:
        key = ('join', edge['joinId']) if edge['kind'] == 'join' else (
            ('conditional', edge['from'], edge['route']) if edge['kind'] == 'conditional' else ('normal', edge['id']))
        groups[key].append(edge)
    for group in groups.values():
        edge = group[0]; prefix = graph['symbol']
        if edge['kind'] == 'normal':
            added_lines.append(prefix + '.add_edge(' + endpoint(edge['from']) + ', ' + endpoint(edge['to']) + ')')
        elif edge['kind'] == 'join':
            require(len(group) >= 2 and len({e['to'] for e in group}) == 1, '汇合必须至少两个来源且目的地相同。')
            added_lines.append(prefix + '.add_edge([' + ', '.join(endpoint(e['from']) for e in group) + '], ' + endpoint(edge['to']) + ')')
        else:
            # Merge a changed branch with unchanged branches sharing a router. Keeping two calls
            # to the same named router would be rejected by LangGraph at runtime.
            existing = [e for e in desired if e['kind'] == 'conditional' and e['from'] == edge['from'] and e['route'] == edge['route'] and e['id'] in retained]
            require(not existing, '同一路由的分支分布在多次调用中，请整组修改或先整理源码。')
            mapping = []
            for item in group:
                value = typed_labels.get((item['from'], item['route'], item['label']), item['label'])
                if item['id'] in typed_ids and typed_ids[item['id']][0] == item['label']:
                    value = typed_ids[item['id']][1]
                literal = repr(value)
                mapping.append(literal + ': ' + endpoint(item['to']))
            added_lines.append(prefix + '.add_conditional_edges(' + endpoint(edge['from']) + ', ' + reference(edge['route']) + ', {' + ', '.join(mapping) + '})')
            warnings.append('条件路由函数体保留；新分支值按字符串生成，原有布尔／整数分支保留原类型。请在行为实现阶段检查返回值。')
    if definitions:
        src.insert(builder.lineno, ''.join(definitions))
    if added_lines:
        src.insert(insertion, ''.join(indent + line + src.newline for line in added_lines))

    if target['state']['fields'] != graph['state']['fields']:
        resolved = analyzer.resolve(graph['file'], graph['state']['reference'], graph['scope'])
        require(resolved and isinstance(resolved[1], ast.ClassDef), 'State 必须是可定位的显式 class。')
        state_file, cls = resolved
        for other in original['graphs']:
            if other['id'] == graph_id:
                continue
            shared = analyzer.resolve(other['file'], other['state']['reference'], other['scope'])
            require(not shared or (shared[0], shared[1].lineno) != (state_file, cls.lineno), 'State 被其他图共享，本阶段不联动修改。')
        state_src = sources[state_file]
        cls = next(n for n in ast.walk(state_src.tree) if isinstance(n, ast.ClassDef) and n.lineno == cls.lineno)
        fields = {n.target.id: n for n in cls.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
        require(len(fields) == len(graph['state']['fields']), 'State 字段定义不唯一。')
        target_fields = {f['name']: f for f in target['state']['fields']}
        require(len(target_fields) == len(target['state']['fields']), 'State 字段名称重复。')
        allowed = (ast.Expression, ast.Name, ast.Load, ast.Attribute, ast.Subscript, ast.Tuple, ast.List, ast.Constant, ast.BinOp, ast.BitOr, ast.Slice)
        available = set(dir(builtins)) | {cls.name}
        available.update(n.name for n in ast.walk(state_src.tree) if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)))
        available.update(a.asname or a.name.split('.')[0] for n in ast.walk(state_src.tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names)
        available.update(n.id for n in ast.walk(state_src.tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store))
        for name, field in target_fields.items():
            require(identifier(name), 'State 字段不是有效 Python 名称。')
            expression = ast.parse(field['annotation'], mode='eval')
            require(all(isinstance(n, allowed) for n in ast.walk(expression)), '类型注解含动态调用或不支持的表达式。')
            require(all(n.id in available for n in ast.walk(expression) if isinstance(n, ast.Name)), '类型注解引用未导入的名称；请先在源码中导入。')
        for name, field in fields.items():
            if name not in target_fields:
                state_src.remove(field)
                warnings.append('移除 State 字段 ' + name + '；节点对该字段的读写需要在行为实现阶段检查。')
            elif text(field.annotation) != target_fields[name]['annotation']:
                state_src.replace(field.annotation, target_fields[name]['annotation'])
                warnings.append('State 字段 ' + name + ' 的类型／reducer 已按草稿修改，尚未运行验证。')
        field_indent = state_src.statement(next(iter(fields.values()))) if fields else state_src.statement(cls) + '    '
        new_fields = [field_indent + name + ': ' + f['annotation'] + state_src.newline for name, f in target_fields.items() if name not in fields]
        # Put fields before the first existing statement: preserves class docstring position.
        has_docstring = isinstance(cls.body[0], ast.Expr) and isinstance(cls.body[0].value, ast.Constant) and isinstance(cls.body[0].value.value, str)
        anchor_line = cls.body[0].end_lineno + 1 if has_docstring else cls.body[0].lineno
        if new_fields:
            state_src.insert(anchor_line, ''.join(new_fields))
        if not target_fields and all(isinstance(n, (ast.AnnAssign, ast.Pass)) for n in cls.body):
            state_src.insert(cls.body[0].lineno, field_indent + 'pass' + state_src.newline)

    # Resolve may have read additional files. No such file is written or imported.
    require(set(analyzer.hashes) == set(sources), '存在快照之外的依赖，请先整理项目后重试。')
    outputs = {file: source.render() for file, source in sources.items()}
    with tempfile.TemporaryDirectory(prefix='langcontour-source-preview-') as directory:
        snapshot = Path(directory)
        for file, raw in outputs.items():
            out = confined(snapshot, file)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(raw)
        verified = Analyzer(snapshot).scan()
        require(not verified['diagnostics'], '生成的源码未通过重新解析。')
        result = next((g for g in verified['graphs'] if g['id'] == graph_id), None)
        require(result and not result['diagnostics'] and shape(result) == shape(target, True), '生成结构与目标草稿不一致，已丢弃临时副本。')
        for before in original['graphs']:
            if before['id'] != graph_id:
                after = next((g for g in verified['graphs'] if g['id'] == before['id']), None)
                require(after and shape(before) == shape(after), '生成过程影响了其他图，已丢弃临时副本。')
        require(Analyzer(root).scan()['revision'] == base_revision, '生成期间原源码已变化，请重新确认。')
        changed = [{'file': file, 'before': source.content, 'after': outputs[file].decode(source.encoding),
                    'baseHash': digest(source.raw), 'generatedHash': digest(outputs[file]), 'encoding': source.encoding}
                   for file, source in sources.items() if source.raw != outputs[file]]
        for item in changed:
            item['diff'] = unified(item['before'], item['after'], 'a/' + item['file'], 'b/' + item['file'])
            item['undoDiff'] = unified(item['after'], item['before'], 'b/' + item['file'], 'a/' + item['file'])
            if include_bytes:
                item['_beforeBytes'] = base64.b64encode(sources[item['file']].raw).decode('ascii')
                item['_afterBytes'] = base64.b64encode(outputs[item['file']]).decode('ascii')
        return {'schemaVersion': 1, 'graphId': graph_id, 'baseRevision': base_revision,
                'generatedRevision': verified['revision'], 'verified': True, 'originalModified': False,
                'files': changed, 'warnings': list(dict.fromkeys(warnings)), 'placeholders': placeholders,
                'behaviorRequirements': [{'nodeId': n['id'], 'functionRef': n['functionRef'], 'description': n.get('description', '')}
                                         for n in new_nodes.values() if n['id'] not in old_nodes or n.get('description', '') != old_nodes[n['id']].get('summary', '')]}
