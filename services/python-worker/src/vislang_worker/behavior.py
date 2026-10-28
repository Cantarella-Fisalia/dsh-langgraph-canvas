"""Owned Python-only workspaces and static acceptance of Harness function edits."""
from __future__ import annotations

import ast
import base64
import copy
import io
import json
import os
import re
import secrets
import shutil
import tempfile
import tokenize
from collections import Counter
from pathlib import Path

from .analysis import Analyzer, MAX_BYTES, arg, digest
from .source_preview import shape, unified
from .transactions import Transactions, TransactionError, canonical, check, now

ACTIVE = {'submitting', 'queued', 'running', 'cancelling', 'needs_attention'}
TERMINAL = {'cancelled', 'review_ready', 'failed', 'conflicted'}
MARKER = '.vis4agent-owner.json'


def decoded(raw):
    encoding = tokenize.detect_encoding(io.BytesIO(raw).readline)[0]
    return raw.decode(encoding), encoding


def definitions(tree):
    found = {}
    def walk(body, prefix=''):
        for item in body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = prefix + item.name
                found[name] = item
                walk(item.body, name + '.')
    walk(tree.body)
    return found


def function_body(node):
    body = node.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    return ast.dump(ast.Module(body=body, type_ignores=[]))


def skeleton(tree, permitted):
    tree = copy.deepcopy(tree)
    for name, item in definitions(tree).items():
        if name in permitted:
            item.body = [ast.Pass()]
    tree.body = [item for item in tree.body if not isinstance(item, (ast.Import, ast.ImportFrom))]
    return ast.dump(tree)


def import_changes(before, after):
    imports = lambda tree: [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    original = Counter(ast.dump(n) for n in imports(before))
    remaining = Counter(ast.dump(n) for n in imports(after))
    check(not original - remaining, 'INVALID_BEHAVIOR_RESULT', '不能删除或更换原有模块导入。', 422)
    bound = set()
    for n in before.body:
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            bound.update(a.asname or a.name.split('.')[0] for a in n.names)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(n.name)
        else:
            bound.update(x.id for x in ast.walk(n) if isinstance(x, ast.Name) and isinstance(x.ctx, ast.Store))
    additions = remaining - original
    for n in imports(after):
        key = ast.dump(n)
        if additions[key]:
            for alias in n.names:
                name = alias.asname or alias.name.split('.')[0]
                check(name != '*' and name not in bound, 'INVALID_BEHAVIOR_RESULT', '新增导入覆盖已有符号：' + name, 422)
                bound.add(name)
            additions[key] -= 1


class BehaviorTasks:
    def __init__(self, root):
        self.store = Transactions(root)
        self.root = self.store.root
        self.directory = self.root / '.vislang' / 'behavior-tasks'

    def path(self, task_id):
        check(isinstance(task_id, str) and re.fullmatch('[a-f0-9]{32}', task_id), 'INVALID_TASK_ID', '行为任务编号无效。', 400)
        return self.store.safe('.vislang/behavior-tasks/' + task_id + '.json')

    def save(self, task):
        directory = self.store.safe('.vislang/behavior-tasks')
        directory.mkdir(parents=True, exist_ok=True)
        task['updatedAt'] = now()
        task.pop('_recordHash', None)
        task['_recordHash'] = digest(canonical(task).encode())
        raw = canonical(task).encode('utf-8')
        total = sum(p.stat().st_size for p in directory.glob('*.json') if p.name != task['id'] + '.json')
        check(len(raw) <= 64 * 1024 * 1024 and total + len(raw) <= 256 * 1024 * 1024, 'TASK_LIMIT', '行为任务记录超出限制，请先归档。', 429)
        self.store.atomic(self.path(task['id']), raw)

    def load(self, task_id):
        path = self.path(task_id)
        check(path.is_file(), 'TASK_NOT_FOUND', '行为任务不存在。', 404)
        check(path.stat().st_size <= 64 * 1024 * 1024, 'INVALID_TASK_RECORD', '行为任务记录过大。')
        try:
            task = json.loads(path.read_text(encoding='utf-8'))
            stored = task.pop('_recordHash')
            check(stored == digest(canonical(task).encode()), 'INVALID_TASK_RECORD', '行为任务记录损坏。')
            task['_recordHash'] = stored
            check(task['id'] == task_id and task['status'] in ACTIVE | TERMINAL, 'INVALID_TASK_RECORD', '行为任务状态无效。')
            return task
        except (KeyError, TypeError, ValueError) as error:
            if isinstance(error, TransactionError):
                raise
            raise TransactionError('INVALID_TASK_RECORD', '无法读取行为任务记录：' + str(error))

    @staticmethod
    def public(task):
        return {k: v for k, v in task.items() if not k.startswith('_')}

    def list(self):
        if not self.store.safe('.vislang/behavior-tasks').exists():
            return {'tasks': []}
        with self.store.locked():
            paths = list(self.directory.glob('*.json'))
            check(len(paths) <= 100, 'TASK_LIMIT', '行为任务超过 100 条，请先归档。', 429)
            check(sum(p.stat().st_size for p in paths) <= 256 * 1024 * 1024, 'TASK_LIMIT', '行为任务记录超过 256 MiB。', 429)
            return {'tasks': sorted([self.public(self.load(p.stem)) for p in paths], key=lambda t: t['createdAt'], reverse=True)}

    def workspace(self, task):
        path = Path(task['_workspace'])
        expected_parent = Path(tempfile.gettempdir()).resolve()
        check(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)() and path.resolve().parent == expected_parent
              and path.name.startswith('vis4agent-behavior-'), 'UNSAFE_WORKSPACE', '临时工作区路径不安全。')
        check(path.is_dir(), 'WORKSPACE_MISSING', '临时工作区已丢失，不能导入结果。')
        marker = path / MARKER
        check(not marker.is_symlink() and marker.read_text(encoding='utf-8') == task['_owner'], 'UNSAFE_WORKSPACE', '临时工作区所有权标记不匹配。')
        return path.resolve()

    def snapshot(self, task):
        root = self.workspace(task)
        result = {}
        total = 0
        for directory, dirs, names in os.walk(root, followlinks=False):
            for name in dirs + names:
                path = Path(directory, name)
                check(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(), 'UNSAFE_WORKSPACE', '临时工作区含链接，拒绝导入。', 422)
            for name in names:
                path = Path(directory, name)
                file = path.relative_to(root).as_posix()
                if file == MARKER:
                    continue
                check(file in task['_inputFiles'] and path.stat().st_size <= MAX_BYTES, 'INVALID_BEHAVIOR_RESULT', '任务创建了未授权文件或超出大小：' + file, 422)
                raw = path.read_bytes(); total += len(raw)
                check(total <= 16 * 1024 * 1024, 'INVALID_BEHAVIOR_RESULT', '任务结果超过 16 MiB。', 422)
                result[file] = raw
        check(set(result) == set(task['_inputFiles']), 'INVALID_BEHAVIOR_RESULT', '任务删除了源码文件。', 422)
        return result

    def cleanup(self, task):
        # Only after the adapter has acknowledged a stopped writer. Check the exact owned
        # absolute directory and all links before recursive removal on Windows.
        try:
            self.snapshot(task)
            path = self.workspace(task)
            check(path.parent == Path(tempfile.gettempdir()).resolve() and path.name.startswith('vis4agent-behavior-'),
                  'UNSAFE_WORKSPACE', '清理范围无效。')
            shutil.rmtree(path)
            task['_workspaceCleaned'] = True
        except (OSError, TransactionError) as error:
            task['message'] += ' 临时目录保留：' + str(error)

    def prepare(self, request_id, transaction_id, review_hash):
        check(isinstance(request_id, str) and re.fullmatch('[a-zA-Z0-9_-]{8,100}', request_id), 'INVALID_REQUEST_ID', '行为请求 ID 无效。', 400)
        with self.store.locked():
            records = self.store.recover_pending()
            check(not any(r['status'] == 'recovery_required' for r in records), 'RECOVERY_REQUIRED', '请先处理源码恢复。')
            task_id = digest(request_id.encode())[:32]
            fingerprint = digest(canonical({'transactionId': transaction_id, 'reviewHash': review_hash}).encode())
            if self.path(task_id).exists():
                task = self.load(task_id)
                check(task['_fingerprint'] == fingerprint, 'REQUEST_ID_REUSED', '行为请求 ID 对应其他内容。')
                return {'task': self.public(task), 'dispatch': False}
            check(len(list(self.directory.glob('*.json'))) < 100, 'TASK_LIMIT', '行为任务已达 100 条，请先归档。', 429)
            existing = list(self.directory.glob('*.json'))
            check(sum(p.stat().st_size for p in existing) <= 256 * 1024 * 1024, 'TASK_LIMIT', '行为任务记录超过 256 MiB。', 429)
            check(sum(self.load(p.stem)['status'] in ACTIVE for p in existing) < 3, 'ACTIVE_TASK_LIMIT', '已有 3 个未结束或待核对任务，请先完成或取消。', 429)
            parent = self.store.load(transaction_id)
            check(parent['reviewHash'] == review_hash, 'REVIEW_CHANGED', '审阅摘要已变化。')
            check(parent['status'] in ('prepared', 'applied'), 'INVALID_STATE', '该源码事务不能发起行为任务。')
            analyzer = Analyzer(self.root); analysis = analyzer.scan()
            expected = parent['baseRevision'] if parent['status'] == 'prepared' else parent['generatedRevision']
            check(analysis['revision'] == expected, 'SOURCE_CHANGED', '源码已变化，请重新创建草稿。')
            check(not analysis['diagnostics'], 'INVALID_BEHAVIOR_CONTEXT', '项目有解析诊断。', 422)
            base_files = {f: self.store.safe(f, True).read_bytes() for f in analyzer.hashes}
            check(sum(map(len, base_files.values())) <= 16 * 1024 * 1024, 'TASK_LIMIT', '源码副本超过 16 MiB。', 429)
            check(all(digest(raw) == analyzer.hashes[file] for file, raw in base_files.items()), 'SOURCE_CHANGED', '读取快照时源码发生变化。')
            inputs = dict(base_files)
            if parent['status'] == 'prepared':
                inputs.update({f['file']: self.store.raw(f, 'after') for f in parent['files']})
            # Baseline before the structural transaction, for route-key changes.
            before_files = dict(base_files)
            before_files.update({f['file']: self.store.raw(f, 'before') for f in parent['files']})
            before = Analyzer(self.root)
            for file, raw in before_files.items():
                content, _ = decoded(raw); before.modules[file] = (ast.parse(content), content)
            old_graph = next(g for g in before.analyze_file(parent['graphId'].split('::')[0]) if g['id'] == parent['graphId'])
            directory = Path(tempfile.mkdtemp(prefix='vis4agent-behavior-')).resolve()
            check(directory.parent == Path(tempfile.gettempdir()).resolve(), 'UNSAFE_WORKSPACE', '临时目录不在指定位置。')
            owner = canonical({'taskId': task_id, 'token': secrets.token_hex(24)})
            (directory / MARKER).write_text(owner, encoding='utf-8')
            task = {'schemaVersion': 1, 'id': task_id, 'requestId': request_id, 'transactionId': transaction_id,
                    'graphId': parent['graphId'], 'baseRevision': expected, 'status': 'submitting', 'createdAt': now(),
                    'message': '已保存确认请求，等待宿主任务回执。', 'requirements': [], '_workspace': str(directory), '_owner': owner,
                    '_fingerprint': fingerprint, '_originRequestId': parent['requestId'],
                    '_baseFiles': {f: base64.b64encode(raw).decode('ascii') for f, raw in base_files.items()},
                    '_inputFiles': {f: base64.b64encode(raw).decode('ascii') for f, raw in inputs.items()}}
            try:
                for file, raw in inputs.items():
                    path = directory / file; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
                model = Analyzer(directory); model_analysis = model.scan()
                check(model_analysis['revision'] == parent['generatedRevision'], 'SOURCE_CHANGED', '工作副本与已审阅源码版本不一致。')
                graph = next(g for g in model_analysis['graphs'] if g['id'] == parent['graphId'])
                check(not graph['diagnostics'] and not model_analysis['diagnostics'], 'INVALID_BEHAVIOR_CONTEXT', '工作副本不能完整解析。', 422)
                requests = []
                for r in parent['preview']['behaviorRequirements']:
                    check(r.get('description', '').strip() or r['functionRef'] not in parent['preview']['placeholders'],
                          'MISSING_BEHAVIOR_REQUIREMENT', '请先填写节点职责：' + r['nodeId'], 400)
                    if r.get('description', '').strip():
                        requests.append({**r, 'kind': 'node'})
                old_routes = {}
                for e in old_graph['edges']:
                    if e['kind'] == 'conditional':
                        old_routes.setdefault((e['from'], e['route']), set()).add(e['label'])
                routes = {}
                for e in graph['edges']:
                    if e['kind'] == 'conditional':
                        routes.setdefault((e['from'], e['route']), []).append(e)
                for (source, ref), edges in routes.items():
                    if ref in parent['preview']['placeholders'] or {e['label'] for e in edges} != old_routes.get((source, ref), set()):
                        values = []
                        tree, _ = model.module(graph['file'])
                        loc = edges[0]['source']
                        call = next(n for n in ast.walk(tree) if isinstance(n, ast.Call) and n.lineno == loc['line'] and n.col_offset == loc['column'])
                        mapping = arg(call, 2 if call.func.attr == 'add_conditional_edges' else 1, 'path_map')
                        values = [k.value for k in mapping.keys] if isinstance(mapping, ast.Dict) else [e['label'] for e in edges]
                        requests.append({'nodeId': 'route:' + ref, 'functionRef': ref, 'kind': 'route', 'branchValues': values,
                                         'description': '实现路由，返回已登记分支值；按 State 判断，不改变路径映射。'})
                required = {}
                for item in requests:
                    resolved = model.resolve(graph['file'], item['functionRef'], graph['scope'])
                    check(resolved and isinstance(resolved[1], (ast.FunctionDef, ast.AsyncFunctionDef)), 'INVALID_BEHAVIOR_CONTEXT', '无法定位函数：' + item['functionRef'], 422)
                    file, node = resolved
                    tree, _ = model.module(file)
                    symbol = next(name for name, value in definitions(tree).items() if value is node)
                    key = (file, symbol)
                    if key in required:
                        required[key]['description'] += '\n' + item['description']
                        if 'branchValues' in item:
                            required[key]['branchValues'] = item['branchValues']
                        continue
                    affected = [n['id'] if g['id'] == graph['id'] else g['id'] + ':' + n['id'] for g in model_analysis['graphs'] for n in g['nodes']
                                if n.get('implementation', {}).get('file') == file and n['implementation']['line'] == node.lineno]
                    required[key] = {**item, 'file': file, 'symbol': symbol, 'affectedNodes': affected}
                check(required, 'NO_BEHAVIOR_REQUIREMENTS', '未包含节点职责或待实现路由。请先编辑节点职责并生成预览。', 400)
                task['requirements'] = list(required.values()); task['_graph'] = graph
                task['_allGraphs'] = model_analysis['graphs']
                check(Analyzer(self.root).scan()['revision'] == expected, 'SOURCE_CHANGED', '准备期间源码已变化。')
                self.save(task)
                return {'task': self.public(task), 'dispatch': True, 'assignment': self.assignment(task)}
            except Exception:
                self.cleanup(task)
                raise

    def assignment(self, task):
        return {'schemaVersion': 1, 'taskId': task['id'], 'idempotencyKey': task['id'], 'workingDirectory': str(self.workspace(task)),
                'allowedFiles': sorted({r['file'] for r in task['requirements']}), 'requirements': task['requirements'], 'graph': task['_graph'],
                'originalProjectWriteAllowed': False, 'executeProjectAllowed': False,
                'instruction': '只在指定工作副本中修改 allowedFiles 内列出的函数体和 docstring，保持函数签名、构图、State、其他函数与既有导入。'
                               '允许添加不覆盖已有符号的模块导入；不新增文件、模块级辅助函数、依赖清单，不运行用户项目。'
                               '共享函数会影响 affectedNodes。实现节点职责或路由返回值，移除待实现占位，保留其余格式与注释。'
                               '不得访问原项目或在任务结束后继续写副本。提交结果仅供审阅，不直接应用。'}

    def update(self, task_id, status, message='', host_task_id=None, stopped=False):
        check(status in ACTIVE | TERMINAL - {'review_ready'}, 'INVALID_TASK_STATE', '任务状态无效。', 400)
        check(status != 'cancelled' or stopped is True, 'CANCELLATION_PENDING', '宿主尚未确认停止，不能标记已取消。')
        with self.store.locked():
            task = self.load(task_id)
            if task['status'] in TERMINAL:
                return self.public(task)
            previous = (task['status'], task['message'], task.get('hostTaskId'), task.get('cancelRequested'))
            if status == 'cancelling':
                task['cancelRequested'] = True
            if task.get('cancelRequested') and status in ('queued', 'running'):
                status = 'cancelling'
            task['status'] = status; task['message'] = str(message)[:2000]
            if host_task_id:
                check(isinstance(host_task_id, str) and len(host_task_id) <= 500, 'INVALID_HOST_RECEIPT', '宿主任务回执无效。', 502)
                task['hostTaskId'] = host_task_id
            if previous == (task['status'], task['message'], task.get('hostTaskId'), task.get('cancelRequested')):
                return self.public(task)
            if status == 'cancelled' and stopped:
                self.save(task)
                self.cleanup(task)
                task.pop('_baseFiles', None); task.pop('_inputFiles', None)
            self.save(task)
            return self.public(task)

    def finalize(self, task_id):
        with self.store.locked():
            task = self.load(task_id)
            if task['status'] in TERMINAL:
                return self.public(task)
            check(not task.get('cancelRequested'), 'CANCELLATION_PENDING', '取消中的结果不会导入。')
            try:
                records = self.store.recover_pending()
                check(not any(r['status'] == 'recovery_required' for r in records), 'RECOVERY_REQUIRED', '原项目有待恢复事务。')
                check(Analyzer(self.root).scan()['revision'] == task['baseRevision'], 'SOURCE_CHANGED', '任务期间原源码已变化，未导入结果。')
                outputs = self.snapshot(task)
                for file, raw in outputs.items():
                    compile(decoded(raw)[0], file, 'exec', dont_inherit=True)  # Compile only; never execute/import user code.
                permitted = {}
                for req in task['requirements']:
                    permitted.setdefault(req['file'], set()).add(req['symbol'])
                for file, encoded in task['_inputFiles'].items():
                    before = base64.b64decode(encoded, validate=True)
                    if file not in permitted:
                        check(outputs[file] == before, 'INVALID_BEHAVIOR_RESULT', '任务修改了未授权文件：' + file, 422)
                        continue
                    old_tree = ast.parse(decoded(before)[0]); new_tree = ast.parse(decoded(outputs[file])[0])
                    check(skeleton(old_tree, permitted[file]) == skeleton(new_tree, permitted[file]), 'INVALID_BEHAVIOR_RESULT', '任务改变了构图、State、签名或未授权代码：' + file, 422)
                    import_changes(old_tree, new_tree)
                    old_defs, new_defs = definitions(old_tree), definitions(new_tree)
                    for name in permitted[file]:
                        node = new_defs[name]
                        check(function_body(old_defs[name]) != function_body(node), 'INVALID_BEHAVIOR_RESULT', '函数行为未发生变化：' + name, 422)
                        check(not any(isinstance(n, ast.Raise) and isinstance(n.exc, (ast.Name, ast.Call)) and
                                      ((isinstance(n.exc, ast.Name) and n.exc.id == 'NotImplementedError') or
                                       (isinstance(n.exc, ast.Call) and isinstance(n.exc.func, ast.Name) and n.exc.func.id == 'NotImplementedError'))
                                      for n in ast.walk(node)), 'INVALID_BEHAVIOR_RESULT', '仍含待实现占位：' + name, 422)
                        body = node.body[1:] if ast.get_docstring(node) else node.body
                        check(body and not all(isinstance(n, ast.Pass) or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and n.value.value is Ellipsis) for n in body),
                              'INVALID_BEHAVIOR_RESULT', '函数仍为空实现：' + name, 422)
                verified = Analyzer(self.workspace(task)).scan()
                check(not verified['diagnostics'] and all(not g['diagnostics'] for g in verified['graphs']), 'INVALID_BEHAVIOR_RESULT', '任务结果解析失败。', 422)
                check({g['id']: shape(g) for g in verified['graphs']} == {g['id']: shape(g) for g in task['_allGraphs']},
                      'INVALID_BEHAVIOR_RESULT', '任务结果改变了图结构。', 422)
                check(outputs == self.snapshot(task), 'INVALID_BEHAVIOR_RESULT', '导入期间副本仍在变化。', 422)
                check(Analyzer(self.root).scan()['revision'] == task['baseRevision'], 'SOURCE_CHANGED', '验收期间原源码已变化。')
                changed = []
                for file, encoded in task['_baseFiles'].items():
                    before = base64.b64decode(encoded, validate=True); after = outputs[file]
                    if before == after:
                        continue
                    original, old_encoding = decoded(before); generated, new_encoding = decoded(after)
                    changed.append({'file': file, 'before': original, 'after': generated, 'baseHash': digest(before), 'generatedHash': digest(after),
                                    'encoding': old_encoding if old_encoding == new_encoding else old_encoding + ' → ' + new_encoding,
                                    'diff': unified(original, generated, 'a/' + file, 'b/' + file), 'undoDiff': unified(generated, original, 'b/' + file, 'a/' + file),
                                    '_beforeBytes': encoded, '_afterBytes': base64.b64encode(after).decode('ascii')})
                check(changed, 'INVALID_BEHAVIOR_RESULT', '任务没有生成源码修改。', 422)
                warnings = ['此结果只通过语法、允许修改范围与图结构检查；未运行用户代码或业务测试，请审阅所有差异和新增导入。']
                warnings += ['共享函数 ' + r['functionRef'] + ' 影响节点：' + '、'.join(r['affectedNodes']) for r in task['requirements'] if len(r['affectedNodes']) > 1]
                preview = {'schemaVersion': 1, 'graphId': task['graphId'], 'baseRevision': task['baseRevision'], 'generatedRevision': verified['revision'],
                           'verified': True, 'originalModified': False, 'files': changed, 'warnings': warnings, 'placeholders': [], 'behaviorRequirements': []}
                review = self.store.store_review(preview, 'behavior-result-' + task['id'], digest(canonical({'taskId': task['id'], 'revision': verified['revision']}).encode()),
                                                kind='behavior', originRequestId=task['_originRequestId'], behaviorTaskId=task['id'])
                task['resultTransactionId'] = review['transaction']['id']; task['status'] = 'review_ready'
                task['message'] = '行为代码已通过静态范围检查，等待审阅和单独确认应用；原项目未改动。'
                self.save(task)
                self.cleanup(task)
                task.pop('_baseFiles', None); task.pop('_inputFiles', None)
            except Exception as error:
                task['status'] = 'conflicted' if getattr(error, 'code', '') == 'SOURCE_CHANGED' else 'failed'
                task['message'] = '结果未导入：' + str(error)
            self.save(task)
            return self.public(task)
