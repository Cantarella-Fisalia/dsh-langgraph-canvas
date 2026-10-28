import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { isHostContext, trustedHostMessage } from './host.ts';

const context = {
  schemaVersion: 1, type: 'vis4agent:host-context', workspaceRoot: 'E:/current-workspace',
  theme: { colorScheme: 'light', tokens: { '--dsw-alias-bg-base': '#ffffff' } },
};
test('host context is versioned, typed and limits theme token names', () => {
  assert.equal(isHostContext(context), true);
  assert.equal(isHostContext({ ...context, sessionId: 'session-1' }), true);
  assert.equal(isHostContext({ ...context, sessionId: {} }), false);
  assert.equal(isHostContext({ ...context, sessionId: '../other' }), false);
  assert.equal(isHostContext({ ...context, workspaceRoot: 42 }), false);
  assert.equal(isHostContext({ ...context, schemaVersion: 2 }), false);
  assert.equal(isHostContext({ ...context, theme: { ...context.theme, tokens: { unexpected: 'red' } } }), false);
});
test('only the owning same-origin host can supply workspace and theme', () => {
  const parent = {} as Window;
  assert.equal(trustedHostMessage({ source: parent, origin: 'https://host.test', data: context }, parent, 'https://host.test', 'https:'), true);
  assert.equal(trustedHostMessage({ source: {} as Window, origin: 'https://host.test', data: context }, parent, 'https://host.test', 'https:'), false);
  assert.equal(trustedHostMessage({ source: parent, origin: 'https://foreign.test', data: context }, parent, 'https://host.test', 'https:'), false);
});
test('Electron custom origin is accepted only from the owning window', () => {
  const parent = {} as Window;
  for (const origin of ['null', 'dsh-app://app']) {
    assert.equal(trustedHostMessage({ source: parent, origin, data: context }, parent, 'null', 'dsh-app:'), true);
  }
  assert.equal(trustedHostMessage({ source: parent, origin: 'null', data: context }, parent, 'https://host.test', 'https:'), false);
});
test('native slot uses current workspace, propagates theme and registers no overlay', async () => {
  const source = await readFile(new URL('../../../plugins/harness/client/client.js', import.meta.url), 'utf8');
  let plugin: any;
  const slots: any[] = [];
  let activeTheme = { active: { colorScheme: 'light' } };
  const sent: any[] = [];
  const panels: string[] = [];
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }),
    useState: (value: any) => [value, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useCallback: (fn: any) => fn,
    useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
  };
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration: any) => { plugin = registration.factory(() => react); } } },
    location: { origin: 'https://host.test', protocol: 'https:', host: 'host.test' },
    document: { body: {} },
    getComputedStyle: () => ({ 0: '--dsw-alias-bg-base', length: 1, fontFamily: 'Harness font',
      getPropertyValue: () => activeTheme.active.colorScheme === 'light' ? '#ffffff' : '#17191c' }),
  });
  plugin.apply({
    slots: {
      inject: (_name: string, factory: () => any) => factory(),
      register: (options: any, component: any) => { slots.push({ options, component }); return () => {}; },
    },
    theme: { getTheme: () => activeTheme },
    layout: { selectPanel: (key: string) => panels.push(key) },
    on: () => () => {},
  });
  assert.equal(slots.filter(slot => slot.options.name === 'shell.overlay').length, 0);
  const native = slots.find(slot => slot.options.name === 'conversation.view');
  assert.equal(native.options.id, 'vis4agent');
  assert.equal(native.options.label(), '架构');
  const entry = slots.find(slot => slot.options.name === 'conversation.header.leading');
  const main = slots.find(slot => slot.options.name === 'main');
  const button = entry.component({
    ...entry.options.inject(),
    useSessions: (selector: any) => selector({ byId: {
      stale: { id: 'stale', retainedBy: { mainView: 0 } },
      current: { id: 'session-1', retainedBy: { mainView: 1 } },
    } }),
  });
  button.props.onClick();
  assert.equal(panels.at(-1), main.options.key);
  assert.equal(main.options.inject().focusSource.getSnapshot(), 'session-1');
  function render(workspacePath: string | null, cwd = 'E:/session-fallback') {
    const props = {
      ...native.options.inject(), sessionId: 'session-1',
      useSessions: (selector: any) => selector({ byId: { 'session-1': { cwd } } }),
      useWorkspaces: (selector: any) => selector({ items: workspacePath ? [{ sessionIds: ['session-1'], path: workspacePath }] : [] }),
    };
    const tree = native.component(props);
    const frame = tree.children[0];
    frame.props.ref.current = { contentWindow: { postMessage: (data: any) => sent.push(data) } };
    frame.props.onLoad();
    return frame;
  }
  assert.ok(render('E:/workspace-a').props.src.includes('embedded=1'));
  assert.equal(sent.at(-1).workspaceRoot, 'E:/workspace-a');
  assert.equal(sent.at(-1).sessionId, 'session-1');
  render('E:/workspace-b');
  assert.equal(sent.at(-1).workspaceRoot, 'E:/workspace-b');
  render(null);
  assert.equal(sent.at(-1).workspaceRoot, 'E:/session-fallback');
  render(null, '');
  assert.equal(sent.at(-1).workspaceRoot, null);
  activeTheme = { active: { colorScheme: 'dark' } };
  render('E:/workspace-b');
  assert.equal(sent.at(-1).theme.colorScheme, 'dark');
  assert.equal(sent.at(-1).theme.tokens['--dsw-alias-bg-base'], '#17191c');
});
