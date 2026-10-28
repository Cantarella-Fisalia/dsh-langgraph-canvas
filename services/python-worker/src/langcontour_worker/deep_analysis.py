"""Read-only AI context and evidence validation; only a derived cache may be written."""
import ast
import json
import os
import tokenize
import uuid
from pathlib import Path
from .analysis import Analyzer, confined, digest, location


def fail(code, message, status=422):
    error = ValueError(message)
    error.code, error.status = code, status
    raise error


def reference(file):
    return any(p.lower() in {'docs', 'doc', 'examples', 'example', 'test', 'tests', 'archive'} for p in Path(file).parts[:-1])


def context(root):
    analyzer = Analyzer(root)
    result = analyzer.scan()
    files = []
    for file in result['scan']['files']:
        if reference(file):
            continue
        try:
            tree, source = analyzer.module(file)
        except (OSError, SyntaxError, ValueError, UnicodeError):
            continue
        imports, symbols = [], []
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                imports.append(ast.unparse(node))
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbols.append({'name': node.name, 'line': node.lineno, 'endLine': node.end_lineno, 'kind': type(node).__name__})
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.col_offset == 0:
                for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
                    if isinstance(target, ast.Name):
                        symbols.append({'name': target.id, 'line': node.lineno, 'endLine': node.end_lineno, 'kind': 'binding'})
        score = sum(source.count(word) * weight for word, weight in [('StateGraph', 8), ('add_node', 6), ('add_edge', 5), ('add_conditional_edges', 5), ('TypedDict', 3), ('langgraph', 2)])
        files.append({'file': file, 'hash': analyzer.hashes[file], 'lines': len(source.splitlines()),
                      'score': score, 'imports': imports[:60], 'symbols': symbols[:160]})
    files.sort(key=lambda item: (-item['score'], item['file']))
    return {'revision': result['revision'], 'files': files, 'staticGraphs': [g for g in result['graphs'] if not reference(g['file'])],
            'limitReached': result['scan']['limitReached']}


def read_source(root, request, files):
    file = request.get('file')
    entry = next((item for item in files if item['file'] == file), None)
    if entry is None:
        fail('ANALYSIS_FILE_DENIED', 'AI 只能读取本次索引内的业务 Python 文件。')
    path = confined(Path(root), file)
    if path.is_symlink() or not path.is_file():
        fail('ANALYSIS_FILE_DENIED', 'AI 源码路径无效。')
    raw = path.read_bytes()
    if digest(raw) != entry['hash']:
        fail('SOURCE_CHANGED', '分析期间源码已变化，请刷新后重新分析。', 409)
    with tokenize.open(path) as handle:
        lines = handle.read().splitlines()
    start, end = request.get('line', 1), request.get('endLine', 160)
    if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or start < 1 or end < start or start > len(lines) or end - start >= 300:
        fail('ANALYSIS_RANGE_DENIED', '每次读取必须指定有效的 1–300 行源码区间。')
    end = min(end, len(lines))
    source = '\n'.join(f'{index + 1}: {lines[index]}' for index in range(start - 1, end))
    if len(source.encode('utf-8')) > 96 * 1024:
        fail('ANALYSIS_SOURCE_LIMIT', '请求的源码片段超过 96 KiB，请缩小行范围。')
    return {'file': file, 'line': start, 'endLine': end, 'column': 0, 'text': source, 'hash': digest(raw)}


def evidence_checker(root, allowed, evidence):
    def source(value):
        if not isinstance(value, dict) or not isinstance(value.get('file'), str) or value['file'] not in allowed or reference(value['file']):
            fail('UNVERIFIED_AI_EVIDENCE', 'AI 结果引用了未授权或参考目录的源码。')
        start, end = value.get('line'), value.get('endLine')
        if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or start < 1 or end < start:
            fail('UNVERIFIED_AI_EVIDENCE', 'AI 源码证据行号无效。')
        # A citation may cross adjacent reads. Every line must still be covered by
        # current, same-file bytes; an unread gap or old hash cannot bridge it.
        ranges = sorted((item['line'], item['endLine']) for item in evidence
                        if item['file'] == value['file'] and item.get('hash') == latest_hash(value['file']))
        cursor = start
        for left, right in ranges:
            if right < cursor:
                continue
            if left > cursor:
                break
            cursor = max(cursor, right + 1)
            if cursor > end:
                break
        if cursor <= end:
            supplied = '、'.join(f'{left}–{right}' for left, right in ranges[:6]) or '无'
            fail('UNVERIFIED_AI_EVIDENCE', f'AI 必须先读取本次引用的源码区间：{value["file"]}:{start}–{end}；本次该文件已读取：{supplied}。请补读并重新核对解读。')
        return {'file': value['file'], 'line': start, 'endLine': end, 'column': 0}

    hashes = {}
    def latest_hash(file):
        if file not in hashes:
            hashes[file] = digest(confined(Path(root), file).read_bytes())
        return hashes[file]
    return source


def validate(root, payload, revision, evidence):
    latest = Analyzer(root).scan()
    if latest['revision'] != revision:
        fail('SOURCE_CHANGED', 'AI 分析期间源码已变化，结果未采用。', 409)
    allowed = set(latest['scan']['files'])
    source = evidence_checker(root, allowed, evidence)
    if not isinstance(payload, dict) or not isinstance(payload.get('graphs'), list) or len(payload['graphs']) > 40:
        fail('INVALID_AI_ANALYSIS', 'AI 结果必须包含最多 40 张图的 graphs 数组。')

    def name(value, label, limit=300):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            fail('INVALID_AI_ANALYSIS', 'AI 返回了无效的' + label)
        return value

    graphs, ids = [], set()
    for candidate in payload['graphs']:
        if not isinstance(candidate, dict):
            fail('INVALID_AI_ANALYSIS', 'AI 图数据无效。')
        file = name(candidate.get('file'), '图文件')
        symbol = name(candidate.get('symbol'), '构建器名称')
        scope = candidate.get('scope', '')
        if file not in allowed or reference(file) or not isinstance(scope, str) or len(scope) > 300:
            fail('INVALID_AI_ANALYSIS', 'AI 图入口不在业务源码内。')
        graph_source = source(candidate.get('source'))
        if graph_source['file'] != file:
            fail('INVALID_AI_ANALYSIS', '图入口与源码证据不一致。')
        identity = file + '::' + (scope + '.' if scope else '') + symbol
        if identity in ids:
            fail('INVALID_AI_ANALYSIS', 'AI 返回了重复的图。')
        ids.add(identity)
        state = candidate.get('state')
        if not isinstance(state, dict) or not isinstance(state.get('fields'), list) or len(state['fields']) > 300:
            fail('INVALID_AI_ANALYSIS', 'AI State 定义无效。')
        state_source = source(state.get('source'))
        fields, field_ids = [], set()
        for field in state['fields']:
            if not isinstance(field, dict):
                fail('INVALID_AI_ANALYSIS', 'AI State 字段格式无效。')
            key = name(field.get('name'), 'State 字段')
            if key in field_ids:
                fail('INVALID_AI_ANALYSIS', 'AI State 字段重复。')
            field_ids.add(key)
            fields.append({'name': key, 'annotation': name(field.get('annotation'), '字段类型', 2000),
                           'source': source(field.get('source', state_source))})
        nodes, node_ids = [], set()
        if not isinstance(candidate.get('nodes'), list) or len(candidate['nodes']) > 500:
            fail('INVALID_AI_ANALYSIS', 'AI 节点集合无效。')
        for node in candidate['nodes']:
            if not isinstance(node, dict):
                fail('INVALID_AI_ANALYSIS', 'AI 节点格式无效。')
            key = name(node.get('id'), '节点 ID')
            if key in node_ids:
                fail('INVALID_AI_ANALYSIS', 'AI 节点 ID 重复。')
            node_ids.add(key)
            item = {'id': key, 'title': key, 'kind': 'boundary' if key in ('__start__', '__end__') else 'unknown', 'execution': 'unknown'}
            if item['kind'] != 'boundary':
                item['registration'] = source(node.get('registration'))
                item['functionRef'] = name(node.get('functionRef', key), '函数引用')
                item['summary'] = str(node.get('summary', ''))[:3000]
                if node.get('implementation'):
                    item['implementation'] = source(node['implementation']); item['kind'] = 'function'
            nodes.append(item)
        edges = []
        if not isinstance(candidate.get('edges'), list) or len(candidate['edges']) > 1500:
            fail('INVALID_AI_ANALYSIS', 'AI 连线集合无效。')
        for index, edge in enumerate(candidate['edges']):
            if not isinstance(edge, dict):
                fail('INVALID_AI_ANALYSIS', 'AI 连线格式无效。')
            start, end, kind = edge.get('from'), edge.get('to'), edge.get('kind')
            if start not in node_ids or end not in node_ids or kind not in ('normal', 'conditional', 'join'):
                fail('INVALID_AI_ANALYSIS', 'AI 连线端点或类型无效。')
            item = {'id': identity + ':ai-e' + str(index), 'from': start, 'to': end, 'kind': kind, 'source': source(edge.get('source'))}
            for key in ['label', 'route', 'joinId']:
                if key in edge:
                    item[key] = '' if key == 'label' and edge[key] == '' else name(edge[key], '连线属性', 1000)
            if kind == 'join' and 'joinId' not in item:
                fail('INVALID_AI_ANALYSIS', 'AI 汇合边缺少明确等待分组。')
            edges.append(item)
        for group in {e.get('joinId') for e in edges if e['kind'] == 'join'}:
            members = [e for e in edges if e.get('joinId') == group]
            if len(members) < 2 or len({e['to'] for e in members}) != 1 or len({e['from'] for e in members}) != len(members):
                fail('INVALID_AI_ANALYSIS', 'AI 等待汇合分组不完整。')
        graphs.append({'schemaVersion': 1, 'id': identity, 'title': str(candidate.get('title', symbol))[:300],
                       'file': file, 'symbol': symbol, 'scope': scope, 'revision': revision,
                       'state': {'reference': name(state.get('reference'), 'State 引用'), 'fields': fields, 'source': state_source},
                       'nodes': nodes, 'edges': edges, 'diagnostics': [],
                       'capabilities': {'structuralEdit': False, 'sourceRead': True},
                       'discovery': {'method': 'ai', 'category': 'project', 'completeness': 'inferred', 'readOnly': True,
                                     'evidenceStatus': 'locations_checked', 'reason': 'AI 推断：源码位置和版本已核对，图语义尚未经运行验证，当前只读。'}})
    # Evidence confirms locations/version, not the semantic truth of an inferred edge.
    message = str(payload.get('message', ''))[:3000]
    unresolved = payload.get('unresolved', [])
    if isinstance(unresolved, list):
        message += ('\n未解析：' + '; '.join(str(item)[:500] for item in unresolved[:12])) if unresolved else ''
    architecture = None
    if 'architecture' in payload:
        from .explanations import validate as validate_explanation
        known = {graph['id']: graph for graph in latest['graphs'] if not reference(graph['file'])}
        for graph in graphs:
            if graph['id'] not in known or known[graph['id']]['discovery']['completeness'] == 'partial':
                known[graph['id']] = graph
        architecture = validate_explanation(payload['architecture'], known, revision, source)
    if Analyzer(root).scan()['revision'] != revision:
        fail('SOURCE_CHANGED', '校验期间源码已变化，结果未采用。', 409)
    return {'revision': revision, 'graphs': graphs, 'message': message,
            **({'architecture': architecture} if architecture is not None else {}),
            'evidence': [{key: value for key, value in item.items() if key != 'text'} for item in evidence]}


def cache_path(root, create=False):
    root = Path(root).resolve()
    directory = root / '.vislang' / 'analysis-cache'
    if not directory.resolve().is_relative_to(root):
        fail('UNSAFE_ANALYSIS_CACHE', '分析缓存目录不能指向项目之外。')
    if create:
        directory.mkdir(parents=True, exist_ok=True)
    if not directory.resolve().is_relative_to(root):
        fail('UNSAFE_ANALYSIS_CACHE', '分析缓存目录不能指向项目之外。')
    path = directory / 'latest.json'
    if path.is_symlink():
        fail('UNSAFE_ANALYSIS_CACHE', '分析缓存不能使用链接。')
    return path


def store(root, validated):
    path = cache_path(root, True)
    body = json.dumps(validated, ensure_ascii=False, sort_keys=True)
    content = json.dumps({'formatVersion': 1, 'digest': digest(body.encode()), 'data': validated}, ensure_ascii=False, sort_keys=True)
    if len(content.encode()) > 2 * 1024 * 1024:
        fail('ANALYSIS_CACHE_LIMIT', '分析结果超过 2 MiB 缓存上限。')
    if Analyzer(root).scan()['revision'] != validated['revision']:
        fail('SOURCE_CHANGED', '保存分析结果前源码已变化。', 409)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as handle:
            handle.write(content); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return {'revision': validated['revision'], 'graphCount': len(validated['graphs']), 'cached': True, 'message': validated['message']}


def cached(root, revision):
    path = cache_path(root)
    if not path.exists():
        return None
    if path.stat().st_size > 2 * 1024 * 1024:
        return None
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
        value = record['data']
        if record.get('formatVersion') != 1 or value['revision'] != revision or record['digest'] != digest(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()):
            return None
        for graph in value['graphs']:
            graph['capabilities'] = {'structuralEdit': False, 'sourceRead': True}
            graph['discovery'] = {'method': 'ai', 'category': 'project', 'completeness': 'inferred', 'readOnly': True,
                                  'evidenceStatus': 'locations_checked', 'reason': 'AI 推断缓存：源码版本一致，当前只读。'}
        if value.get('architecture'):
            from .explanations import validate as validate_explanation
            latest = Analyzer(root).scan()
            if latest['revision'] != revision:
                return None
            known = {graph['id']: graph for graph in latest['graphs'] if not reference(graph['file'])}
            for graph in value['graphs']:
                if graph['id'] not in known or known[graph['id']]['discovery']['completeness'] == 'partial':
                    known[graph['id']] = graph
            value['architecture'] = validate_explanation(value['architecture'], known, revision,
                evidence_checker(root, set(latest['scan']['files']), value.get('evidence', [])))
        return value
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        return None
