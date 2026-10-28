"""Persistent file journal; only confirmed operations can write project source.

Atomic per-file replacement, cooperative cross-process project lock, durable
before/after snapshots, and conservative crash rollback. No user code executes.
"""
from __future__ import annotations

import base64
import contextlib
import datetime
import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path

from .analysis import Analyzer, digest
from .source_preview import generate

ID = re.compile(r'^[a-f0-9]{32}$')
PENDING = {'applying', 'undoing', 'recovery_required'}
STATUSES = PENDING | {'prepared', 'applied', 'undone', 'rolled_back'}


class TransactionError(ValueError):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.status = code, status


def check(condition, code, message, status=409):
    if not condition:
        raise TransactionError(code, message, status)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class Transactions:
    def __init__(self, root, fault=None):
        self.root = Path(root).resolve(strict=True)
        self.directory = self.root / '.vislang' / 'transactions'
        # Internal hook for deterministic failure/crash tests, never a protocol parameter.
        self.fault = fault or (lambda *args: None)

    def safe(self, relative, source=False):
        path = Path(relative)
        check(not path.is_absolute() and '..' not in path.parts and bool(path.parts), 'UNSAFE_PATH', '路径必须位于项目内部。', 400)
        if source:
            check(path.suffix == '.py' and not any(p.startswith('.') for p in path.parts), 'UNSAFE_PATH', '事务只能修改项目内普通 Python 文件。', 400)
        current = self.root
        for part in path.parts:
            current = current / part
            check(not current.is_symlink() and not getattr(current, 'is_junction', lambda: False)(), 'UNSAFE_PATH', '事务路径不能包含符号链接或 Junction。', 400)
        check(current.resolve().is_relative_to(self.root), 'UNSAFE_PATH', '路径不能指向项目外。', 400)
        return current

    @contextlib.contextmanager
    def locked(self):
        directory = self.safe('.vislang/transactions')
        directory.mkdir(parents=True, exist_ok=True)
        lock = self.safe('.vislang/transactions/lock')
        fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
        handle = os.fdopen(fd, 'r+b')
        acquired = False
        try:
            if os.fstat(fd).st_size == 0:
                handle.write(b'0'); handle.flush()
            handle.seek(0)
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError:
                raise TransactionError('PROJECT_LOCKED', '其他插件进程正在修改此项目，请稍后重试。', 423)
            yield
        finally:
            if acquired:
                handle.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_UN)
            handle.close()

    def atomic(self, path, raw, mode=0o600):
        # Temporary is always in the target directory, never on a different volume.
        fd, temporary = tempfile.mkstemp(prefix='.vis4agent-', suffix='.tmp', dir=path.parent)
        temporary = Path(temporary)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            os.chmod(temporary, stat.S_IMODE(mode))
            os.replace(temporary, path)
            if os.name != 'nt':
                directory_fd = os.open(path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            if temporary.exists():
                # This is our own staging file, including after a readonly-target failure.
                os.chmod(temporary, stat.S_IREAD | stat.S_IWRITE)
                temporary.unlink()

    def record_path(self, transaction_id):
        check(isinstance(transaction_id, str) and ID.fullmatch(transaction_id), 'INVALID_TRANSACTION_ID', '事务编号无效。', 400)
        return self.safe('.vislang/transactions/' + transaction_id + '.json')

    def save(self, record):
        record['updatedAt'] = now()
        record.pop('recordHash', None)
        record['recordHash'] = digest(canonical(record).encode())
        raw = canonical(record).encode('utf-8')
        check(len(raw) <= 128 * 1024 * 1024, 'JOURNAL_LIMIT', '事务日志超过 128 MiB 限制。', 429)
        total = sum(p.stat().st_size for p in self.directory.glob('*.json') if p.name != record['id'] + '.json')
        check(total + len(raw) <= 256 * 1024 * 1024, 'JOURNAL_LIMIT', '项目事务日志超过 256 MiB，请先归档旧记录。', 429)
        self.atomic(self.record_path(record['id']), raw)

    def load(self, transaction_id):
        path = self.record_path(transaction_id)
        check(path.is_file(), 'TRANSACTION_NOT_FOUND', '找不到事务记录。', 404)
        check(path.stat().st_size <= 128 * 1024 * 1024, 'INVALID_JOURNAL', '事务记录超出限制。')
        try:
            record = json.loads(path.read_text(encoding='utf-8'))
            stored = record.pop('recordHash')
            check(stored == digest(canonical(record).encode()), 'INVALID_JOURNAL', '事务日志摘要不匹配，未写入源码。')
            record['recordHash'] = stored
            check(record['schemaVersion'] == 1 and record['id'] == transaction_id and record['status'] in STATUSES,
                  'INVALID_JOURNAL', '不支持的事务日志。')
            for file in record['files']:
                self.safe(file['file'], True)
                for side, expected in [('before', 'baseHash'), ('after', 'generatedHash')]:
                    check(digest(self.raw(file, side)) == file[expected], 'INVALID_JOURNAL', '事务源码快照损坏。')
            return record
        except TransactionError:
            raise
        except (ValueError, KeyError, TypeError) as error:
            raise TransactionError('INVALID_JOURNAL', '事务日志无法读取：' + str(error))

    def records(self):
        paths = sorted(self.directory.glob('*.json'))
        check(len(paths) <= 200, 'JOURNAL_LIMIT', '事务记录超过 200 个，请先归档旧记录。', 429)
        check(sum(p.stat().st_size for p in paths) <= 256 * 1024 * 1024, 'JOURNAL_LIMIT', '项目事务日志超过 256 MiB，请先归档旧记录。', 429)
        return [self.load(path.stem) for path in paths]

    @staticmethod
    def raw(file, side):
        return base64.b64decode(file['_' + side + 'Bytes'], validate=True)

    @staticmethod
    def summary(record):
        return {key: record[key] for key in ['id', 'requestId', 'graphId', 'baseRevision', 'generatedRevision', 'reviewHash',
                                             'status', 'createdAt', 'updatedAt']} | {
            'files': [f['file'] for f in record['files']], 'message': record.get('message', ''),
            'kind': record.get('kind', 'structure'), 'originRequestId': record.get('originRequestId'),
            'behaviorTaskId': record.get('behaviorTaskId')}

    def detail(self, record):
        return {**record['preview'], 'transaction': self.summary(record)}

    def recover(self, record):
        """Return all affected files to the pre-operation image, never overwrite a third version."""
        operation = record.get('operation')
        check(operation in ('apply', 'undo'), 'INVALID_JOURNAL', '恢复记录缺少操作类型。')
        start, end = ('before', 'after') if operation == 'apply' else ('after', 'before')
        problems = []
        for file in reversed(record['files']):
            try:
                path = self.safe(file['file'], True)
                current = path.read_bytes()
                if current == self.raw(file, start):
                    continue
                check(current == self.raw(file, end), 'RECOVERY_CONFLICT', '文件存在其他版本：' + file['file'])
                self.atomic(path, self.raw(file, start), path.stat().st_mode)
            except (OSError, TransactionError) as error:
                problems.append(file['file'] + ': ' + str(error))
        if problems:
            record['status'] = 'recovery_required'
            record['message'] = '未覆盖外部修改；仍需恢复：' + '; '.join(problems)
        else:
            record['status'] = 'rolled_back' if operation == 'apply' else 'applied'
            record['message'] = '已恢复至本次操作前的文件快照。'
        self.save(record)
        return not problems

    def recover_pending(self):
        records = self.records()
        for record in records:
            if record['status'] in ('applying', 'undoing'):
                self.recover(record)
        # Recovery requiring external intervention must not be retried or bypassed silently.
        return self.records()

    def prepare(self, request_id, graph_id, base_revision, target, has_changes=True):
        check(isinstance(request_id, str) and re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', request_id), 'INVALID_REQUEST_ID', '请求 ID 无效。', 400)
        with self.locked():
            records = self.recover_pending()
            check(not any(r['status'] == 'recovery_required' for r in records), 'RECOVERY_REQUIRED', '项目有未恢复事务，请先查看历史并处理恢复。')
            transaction_id = hashlib.sha256(request_id.encode()).hexdigest()[:32]
            fingerprint = digest(canonical({'graphId': graph_id, 'baseRevision': base_revision, 'target': target}).encode())
            if self.record_path(transaction_id).exists():
                record = self.load(transaction_id)
                check(record['fingerprint'] == fingerprint, 'REQUEST_ID_REUSED', '请求 ID 已用于不同草稿。')
                check(Analyzer(self.root).scan()['revision'] == base_revision, 'SOURCE_CHANGED', '源码已变化，请重新创建草稿。')
                return self.detail(record)
            check(has_changes is True, 'NO_CHANGES', '草稿没有修改。', 400)
            check(len(records) < 200, 'JOURNAL_LIMIT', '事务记录已达上限，请先归档旧记录。', 429)
            preview = generate(self.root, graph_id, base_revision, target, include_bytes=True)
            return self.store_review(preview, request_id, fingerprint)

    def store_review(self, preview, request_id, fingerprint, **metadata):
        """Caller holds the project lock; behavior validation uses the same application journal."""
        transaction_id = hashlib.sha256(request_id.encode()).hexdigest()[:32]
        if self.record_path(transaction_id).exists():
            record = self.load(transaction_id)
            check(record['fingerprint'] == fingerprint, 'REQUEST_ID_REUSED', '请求 ID 对应其他源码结果。')
            return self.detail(record)
        check(len(self.records()) < 200, 'JOURNAL_LIMIT', '事务记录已达上限，请先归档。', 429)
        files = preview['files']
        public = {**preview, 'requestId': request_id, 'files': [{k: v for k, v in f.items() if not k.startswith('_')} for f in files]}
        review_hash = digest(canonical({'fingerprint': fingerprint, 'files': files, 'warnings': preview['warnings'], 'placeholders': preview['placeholders']}).encode())
        record = {'schemaVersion': 1, 'id': transaction_id, 'requestId': request_id, 'graphId': preview['graphId'],
                  'baseRevision': preview['baseRevision'], 'generatedRevision': preview['generatedRevision'], 'fingerprint': fingerprint,
                  'reviewHash': review_hash, 'status': 'prepared', 'createdAt': now(), 'files': files, 'preview': public, **metadata}
        self.save(record)
        return self.detail(record)

    def list(self):
        if not self.safe('.vislang/transactions').exists():
            return {'transactions': []}
        with self.locked():
            return {'transactions': [self.summary(r) for r in sorted(self.recover_pending(), key=lambda r: r['createdAt'], reverse=True)]}

    def get(self, transaction_id):
        check(self.record_path(transaction_id).is_file(), 'TRANSACTION_NOT_FOUND', '找不到事务记录。', 404)
        with self.locked():
            self.recover_pending()
            return self.detail(self.load(transaction_id))

    def execute(self, transaction_id, operation, confirmed, review_hash, acknowledged=False):
        check(confirmed is True, 'CONFIRMATION_REQUIRED', '必须明确确认才可修改原项目。', 400)
        check(operation in ('apply', 'undo', 'recover'), 'INVALID_OPERATION', '事务操作无效。', 400)
        with self.locked():
            records = self.recover_pending()
            record = self.load(transaction_id)
            check(review_hash == record['reviewHash'], 'REVIEW_CHANGED', '审阅摘要不匹配，请重新查看差异。')
            if operation == 'recover':
                check(record['status'] == 'recovery_required', 'INVALID_STATE', '此事务不需要恢复。')
                check(self.recover(record), 'RECOVERY_REQUIRED', record['message'])
                return self.detail(record)
            check(not any(r['status'] == 'recovery_required' for r in records), 'RECOVERY_REQUIRED', '存在未恢复事务，暂不能应用或撤销。')
            completed = 'applied' if operation == 'apply' else 'undone'
            if record['status'] == completed:
                return self.detail(record)  # Lost response / repeated click never writes twice.
            required = 'prepared' if operation == 'apply' else 'applied'
            check(record['status'] == required, 'INVALID_STATE', '事务状态不允许此操作：' + record['status'])
            check(bool(record['files']), 'NO_SOURCE_CHANGES', '此记录没有源码变更，仅有行为实现要求。', 400)
            if operation == 'apply':
                check(acknowledged is True, 'REVIEW_REQUIRED', '请勾选已审阅差异和实现提示。', 400)
            start, end = ('before', 'after') if operation == 'apply' else ('after', 'before')
            expected = record['baseRevision'] if operation == 'apply' else record['generatedRevision']
            desired = record['generatedRevision'] if operation == 'apply' else record['baseRevision']
            check(Analyzer(self.root).scan()['revision'] == expected, 'SOURCE_CHANGED', '源码已被修改，未覆盖。请核对当前文件与事务记录。')
            for file in record['files']:
                path = self.safe(file['file'], True)
                check(path.is_file() and path.read_bytes() == self.raw(file, start), 'SOURCE_CHANGED', '源码版本不匹配：' + file['file'])
            record['operation'] = operation
            record['status'] = 'applying' if operation == 'apply' else 'undoing'
            self.save(record)  # Durable journal exists before touching the first source file.
            try:
                for index, file in enumerate(record['files']):
                    path = self.safe(file['file'], True)
                    self.fault('before-write', index, path)
                    check(path.read_bytes() == self.raw(file, start), 'SOURCE_CHANGED', '写入前发现文件变化：' + file['file'])
                    self.atomic(path, self.raw(file, end), path.stat().st_mode)
                    self.fault('after-write', index, path)
                check(Analyzer(self.root).scan()['revision'] == desired, 'VERIFY_FAILED', '写入后源码版本核对失败。')
                record['status'] = completed
                record['message'] = '源码已应用并重新解析。' if operation == 'apply' else '源码已撤销并重新解析。'
                self.save(record)
                return self.detail(record)
            except Exception as error:
                recovered = self.recover(record)
                code = 'OPERATION_ROLLED_BACK' if recovered else 'RECOVERY_REQUIRED'
                raise TransactionError(code, '操作失败：' + str(error) + '；' + record['message']) from error
