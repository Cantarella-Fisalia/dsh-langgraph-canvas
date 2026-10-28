"""Bounded source-only symbol resolution. Never imports or evaluates project code."""
import ast
from pathlib import Path


def declarations(body):
    for item in body:
        yield item
        if isinstance(item, (ast.Try, ast.If)):
            yield from declarations(item.body)
            yield from declarations(item.orelse)
            if isinstance(item, ast.Try):
                yield from declarations(item.finalbody)
                for handler in item.handlers:
                    yield from declarations(handler.body)


class Symbols:
    def __init__(self, analyzer):
        self.analyzer = analyzer

    def module_files(self, file, module, level=0):
        if level:
            base = Path(file).parent
            for _ in range(level - 1):
                base = base.parent
            paths = [base / module.replace('.', '/')]
        else:
            roots = [Path('.'), Path('src')]
            # Source packages often sit under backend/ or src/. No sys.path execution.
            roots += list(Path(file).parent.parents) + [Path(file).parent]
            paths = [root / module.replace('.', '/') for root in roots]
        seen = set()
        for path in paths:
            for candidate in [str(path) + '.py', str(path / '__init__.py')]:
                candidate = candidate.replace('\\', '/')
                if candidate in seen:
                    continue
                seen.add(candidate)
                try:
                    self.analyzer.module(candidate)
                    yield candidate
                except (OSError, SyntaxError, ValueError, UnicodeError):
                    pass

    def binding(self, file, expression, scope='', visited=None):
        visited = set() if visited is None else visited
        key = (file, expression, scope)
        if key in visited or len(visited) >= 48:
            return None
        visited = visited | {key}
        names = expression.split('.')
        try:
            tree, _ = self.analyzer.module(file)
        except (OSError, SyntaxError, ValueError, UnicodeError):
            return None
        bodies = [(tree.body, '')]
        body, prefix = tree.body, []
        for name in scope.split('.') if scope else []:
            found = next((n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == name), None)
            if found is None:
                break
            prefix.append(name); body = found.body
            bodies.append((body, '.'.join(prefix)))
        for body, owner in reversed(bodies):
            entries = list(declarations(body))
            # Imports in try/except are source provenance, independent of installed dependencies.
            for entry in entries:
                if isinstance(entry, ast.ImportFrom):
                    for alias in entry.names:
                        if (alias.asname or alias.name) != names[0]:
                            continue
                        module = entry.module or ''
                        rest = '.'.join([alias.name] + names[1:])
                        if module.startswith('langgraph.'):
                            return {'file': file, 'node': None, 'origin': module + '.' + rest, 'scope': owner}
                        for imported in self.module_files(file, module, entry.level):
                            found = self.binding(imported, rest, '', visited)
                            if found:
                                return found
                        if len(names) > 1:
                            for imported in self.module_files(file, '.'.join(filter(None, [module, alias.name])), entry.level):
                                found = self.binding(imported, '.'.join(names[1:]), '', visited)
                                if found:
                                    return found
                elif isinstance(entry, ast.Import):
                    for alias in entry.names:
                        head = alias.asname or alias.name.split('.')[0]
                        if names[0] != head or len(names) < 2:
                            continue
                        rest = '.'.join(names[1:])
                        full = alias.name + '.' + rest if alias.asname else expression
                        if full.startswith('langgraph.'):
                            return {'file': file, 'node': None, 'origin': full, 'scope': owner}
                        module = alias.name if alias.asname else names[0]
                        for imported in self.module_files(file, module):
                            found = self.binding(imported, rest, '', visited)
                            if found:
                                return found
            for entry in reversed(entries):
                if isinstance(entry, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and entry.name == names[0]:
                    node = entry
                    for name in names[1:]:
                        node = next((n for n in getattr(node, 'body', []) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == name), None)
                        if node is None:
                            break
                    if node is not None:
                        return {'file': file, 'node': node, 'origin': '', 'scope': owner}
                targets = entry.targets if isinstance(entry, ast.Assign) else [entry.target] if isinstance(entry, ast.AnnAssign) else []
                if len(names) == 1 and any(isinstance(t, ast.Name) and t.id == names[0] for t in targets):
                    value = entry.value
                    if isinstance(value, (ast.Name, ast.Attribute)):
                        return self.binding(file, ast.unparse(value), owner, visited)
                    return {'file': file, 'node': value, 'origin': '', 'scope': owner}
        return None

    def literal(self, file, node, scope='', env=None, depth=0):
        if node is None or depth > 24:
            raise ValueError('Not a bounded static expression')
        env = env or {}
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name) and node.id in env:
            return env[node.id]
        if isinstance(node, (ast.Name, ast.Attribute)):
            bound = self.binding(file, ast.unparse(node), scope)
            if bound and bound['node'] is not None:
                return self.literal(bound['file'], bound['node'], bound['scope'], {}, depth + 1)
        if isinstance(node, (ast.List, ast.Tuple)):
            return [self.literal(file, n, scope, env, depth + 1) for n in node.elts]
        if isinstance(node, ast.Dict):
            return {self.literal(file, k, scope, env, depth + 1): self.literal(file, v, scope, env, depth + 1)
                    for k, v in zip(node.keys, node.values)}
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return {'_reference': node.name, '_file': file, '_scope': scope}
        raise ValueError('Not a bounded static expression')
