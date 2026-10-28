import json
import sys
import tokenize
from pathlib import Path
from .analysis import Analyzer, MAX_BYTES, confined, digest


def dispatch(request):
    if request.get('schemaVersion') != 1:
        raise ValueError('Unsupported protocol version')
    root = Path(request['params']['root']).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Project root must be a directory')
    if request['method'].startswith('deep-'):
        from . import deep_analysis
        params = request['params']
        method = request['method']
        if method == 'deep-context':
            return deep_analysis.context(root)
        if method == 'deep-source':
            return deep_analysis.read_source(root, params['request'], params['files'])
        if method == 'deep-validate':
            return deep_analysis.validate(root, params['payload'], params['revision'], params['evidence'])
        if method == 'deep-store':
            return deep_analysis.store(root, params['validated'])
        if method == 'deep-cache':
            return deep_analysis.cached(root, params['revision'])
        raise ValueError('Unknown deep analysis method')
    if request['method'] == 'analyze':
        if (root / '.vislang' / 'transactions').exists():
            from .transactions import Transactions
            store = Transactions(root)
            with store.locked():
                store.recover_pending()
                return Analyzer(root).scan()
        return Analyzer(root).scan()
    if request['method'] == 'source-preview':
        from .transactions import Transactions
        params = request['params']
        return Transactions(root).prepare(params['requestId'], params['graphId'], params['baseRevision'], params['target'], params['hasChanges'])
    if request['method'].startswith('behavior-'):
        from .behavior import BehaviorTasks
        params = request['params']; store = BehaviorTasks(root)
        if request['method'] == 'behavior-prepare':
            return store.prepare(params['requestId'], params['transactionId'], params['reviewHash'])
        if request['method'] == 'behavior-list':
            return store.list()
        if request['method'] == 'behavior-get':
            with store.store.locked():
                return store.public(store.load(params['taskId']))
        if request['method'] == 'behavior-update':
            return store.update(params['taskId'], params['status'], params.get('message', ''), params.get('hostTaskId'), params.get('stopped', False))
        if request['method'] == 'behavior-finalize':
            return store.finalize(params['taskId'])
    if request['method'].startswith('transaction-'):
        from .transactions import Transactions
        params = request['params']
        store = Transactions(root)
        if request['method'] == 'transaction-list':
            return store.list()
        if request['method'] == 'transaction-get':
            return store.get(params['transactionId'])
        if request['method'] == 'transaction-execute':
            return store.execute(params['transactionId'], params['operation'], params.get('confirmed'),
                                 params.get('reviewHash'), params.get('acknowledgedWarnings'))
    if request['method'] == 'source':
        file = request['params']['file']
        path = confined(root, file)
        if path.suffix != '.py':
            raise ValueError('Only Python source is supported')
        raw = path.read_bytes()
        if len(raw) > MAX_BYTES:
            raise ValueError('Source exceeds 2 MiB')
        with tokenize.open(path) as handle:
            content = handle.read()
        return {'file': file, 'content': content, 'revision': digest(raw)}
    raise ValueError('Unknown worker method')


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            response = {'schemaVersion': 1, 'id': request['id'], 'result': dispatch(request)}
        except Exception as exc:
            response = {'schemaVersion': 1, 'id': request.get('id'),
                        'error': {'code': getattr(exc, 'code', 'WORKER_ERROR'),
                                  'status': getattr(exc, 'status', 500), 'message': str(exc)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
