"""Validate additive AI explanations against known graph IDs and already read evidence."""


def validate(payload, graphs, revision, source):
    from .deep_analysis import fail

    def reject(message):
        fail('INVALID_AI_EXPLANATION', message)

    def text(value, limit=1800):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            reject('AI 解读文字为空或过长。')
        return value

    def rows(value, limit):
        if not isinstance(value, list) or len(value) > limit or any(not isinstance(item, dict) for item in value):
            reject('AI 解读集合格式无效或超过上限。')
        return value

    def claim(value):
        if not isinstance(value, dict) or not isinstance(value.get('evidence'), list) or not 1 <= len(value['evidence']) <= 10:
            reject('每条 AI 解读都必须提供已读取的源码证据。')
        return {'text': text(value.get('text')), 'evidence': [source(item) for item in value['evidence']]}

    def references(value, allowed):
        if not isinstance(value, list) or len(value) > 300 or any(not isinstance(key, str) or key not in allowed for key in value) or len(set(value)) != len(value):
            reject('AI 解读引用了不存在或重复的字段／节点。')
        return value

    def calls(value):
        return [{'name': text(item.get('name'), 300), 'source': source(item.get('source'))} for item in rows(value, 16)]

    if not isinstance(payload, dict) or payload.get('schemaVersion') != 1:
        reject('AI 解读协议版本必须为 1。')
    output = {'schemaVersion': 1, 'revision': revision, 'overview': claim(payload.get('overview')),
              'graphs': [], 'relationships': [], 'unresolved': []}
    identities = set()
    for item in rows(payload.get('graphs'), 40):
        identity = item.get('graphId')
        if not isinstance(identity, str) or identity not in graphs or identity in identities:
            reject('AI 解读引用了未知或重复的图 ID。')
        identities.add(identity)
        graph = graphs[identity]
        node_map = {node['id']: node for node in graph['nodes'] if node['kind'] != 'boundary'}
        fields = {field['name'] for field in graph['state']['fields']}
        edges = {edge['id'] for edge in graph['edges'] if edge['kind'] == 'conditional'}
        explained = {'graphId': identity, 'purpose': claim(item.get('purpose')),
                     'entry': claim(item.get('entry')), 'exit': claim(item.get('exit')),
                     'stateFields': [], 'nodes': [], 'conditions': []}
        seen = set()
        for field in rows(item.get('stateFields', []), 300):
            key, role = field.get('name'), field.get('role')
            if not isinstance(key, str) or key not in fields or key in seen or role not in ('input', 'intermediate', 'output', 'mixed', 'unknown'):
                reject('AI State 解读包含未知字段、重复字段或无效用途。')
            seen.add(key)
            explained['stateFields'].append({'name': key, 'role': role, 'meaning': claim(field.get('meaning')),
                'readers': references(field.get('readers', []), node_map), 'writers': references(field.get('writers', []), node_map)})
        seen = set()
        for node in rows(item.get('nodes', []), 500):
            key, execution = node.get('nodeId'), node.get('execution')
            if not isinstance(key, str) or key not in node_map or key in seen or execution not in ('function', 'callable', 'subgraph', 'unknown'):
                reject('AI 节点解读包含未知节点、重复节点或无效注册类型。')
            if node_map[key].get('execution') == 'function' and execution != 'function':
                reject('直接注册的 Python 函数仍是函数节点，内部调用不能把它改标为函数组或子图。')
            seen.add(key)
            display_name = None
            if 'displayName' in node:
                display_name = claim(node['displayName'])
                if len(display_name['text']) > 24 or not any('\u3400' <= char <= '\u9fff' for char in display_name['text']):
                    reject('AI 中文功能名必须含汉字且不超过 24 个字符。')
            explained['nodes'].append({'nodeId': key, 'execution': execution, 'summary': claim(node.get('summary')),
                **({'displayName': display_name} if display_name is not None else {}),
                'reads': references(node.get('reads', []), fields), 'writes': references(node.get('writes', []), fields),
                'calls': calls(node.get('calls', []))})
        seen = set()
        for edge in rows(item.get('conditions', []), 1500):
            key = edge.get('edgeId')
            if not isinstance(key, str) or key not in edges or key in seen:
                reject('AI 条件说明必须对应已知的条件边，不能改变分支结构。')
            seen.add(key)
            explained['conditions'].append({'edgeId': key, 'when': claim(edge.get('when'))})
        output['graphs'].append(explained)
    seen = set()
    for item in rows(payload.get('relationships', []), 100):
        start, end, kind = item.get('fromGraphId'), item.get('toGraphId'), item.get('kind')
        if not isinstance(start, str) or not isinstance(end, str) or start not in graphs or end not in graphs or start == end or kind not in ('registered_subgraph', 'indirect_call', 'shared_state', 'possible'):
            reject('AI 图关系端点或类型无效。')
        if item.get('viaNodeId') is not None and not isinstance(item['viaNodeId'], str):
            reject('图关系经过的节点 ID 格式无效。')
        identity = (start, end, kind, item.get('viaNodeId'))
        if identity in seen:
            reject('AI 图关系重复。')
        seen.add(identity)
        relationship = {'fromGraphId': start, 'toGraphId': end, 'kind': kind,
            'explanation': claim(item.get('explanation')), 'callPath': calls(item.get('callPath', []))}
        via = item.get('viaNodeId')
        if via is not None:
            node = next((n for n in graphs[start]['nodes'] if n['id'] == via and n['kind'] != 'boundary'), None)
            if node is None:
                reject('图关系经过的节点不属于来源图。')
            if kind == 'registered_subgraph' and node.get('execution') == 'function':
                reject('函数内部调用子图属于间接调用，不能宣称直接注册子图。')
            relationship['viaNodeId'] = via
        elif kind in ('registered_subgraph', 'indirect_call'):
            reject('调用关系必须指出来源节点，缺失时请标记未确认。')
        if kind == 'indirect_call' and len(relationship['callPath']) < 2:
            reject('间接调用关系必须给出至少两处调用链源码；无法追踪时请标记未确认。')
        output['relationships'].append(relationship)
    unresolved = payload.get('unresolved', [])
    if not isinstance(unresolved, list) or len(unresolved) > 40:
        reject('AI 待确认说明格式无效。')
    output['unresolved'] = [text(item, 600) for item in unresolved]
    return output
