import { useEffect, useState } from 'react';

export interface HostContext {
  schemaVersion: 1;
  type: 'vis4agent:host-context';
  workspaceRoot: string | null;
  sessionId?: string | null;
  theme: { colorScheme: 'light' | 'dark'; tokens: Record<string, string>; fontFamily?: string };
}
export function isHostContext(value: unknown): value is HostContext {
  const context = value as HostContext;
  return !!context && context.schemaVersion === 1 && context.type === 'vis4agent:host-context' &&
    (context.workspaceRoot === null || typeof context.workspaceRoot === 'string') &&
    (context.sessionId === undefined || context.sessionId === null || (typeof context.sessionId === 'string' && /^[\w-]{1,128}$/.test(context.sessionId))) &&
    !!context.theme && ['light', 'dark'].includes(context.theme.colorScheme) &&
    !!context.theme.tokens && typeof context.theme.tokens === 'object' && !Array.isArray(context.theme.tokens) &&
    Object.entries(context.theme.tokens).every(([key, value]) =>
      /^--(?:dsw-|dsh-font-|ds-font-)[a-z0-9-]+$/i.test(key) && typeof value === 'string' && value.length < 2000);
}
export function trustedHostMessage(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  parentWindow: Window, origin: string, protocol: string, host = 'app') {
  const desktopOrigin = protocol + '//' + host;
  return event.source === parentWindow &&
    (event.origin === origin || (protocol === 'dsh-app:' && [desktopOrigin, 'null'].includes(event.origin))) &&
    isHostContext(event.data);
}
function targetOrigin() { return location.origin === 'null' ? '*' : location.origin; }

export function useHostContext(embedded: boolean) {
  const [context, setContext] = useState<HostContext | null>(null);
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    let previousTokens: string[] = [];
    function receive(event: MessageEvent) {
      if (!trustedHostMessage(event, window.parent, location.origin, location.protocol, location.host)) return;
      const context = event.data as HostContext;
      const root = document.documentElement;
      for (const token of previousTokens) root.style.removeProperty(token);
      for (const [name, value] of Object.entries(context.theme.tokens)) root.style.setProperty(name, value);
      previousTokens = Object.keys(context.theme.tokens);
      if (context.theme.fontFamily) root.style.setProperty('--vf-host-font', context.theme.fontFamily);
      root.dataset.colorScheme = context.theme.colorScheme;
      root.style.colorScheme = context.theme.colorScheme;
      setContext(context);
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'vis4agent:ready', schemaVersion: 1 }, targetOrigin());
    return () => { window.removeEventListener('message', receive); previousTokens.forEach(key => document.documentElement.style.removeProperty(key)); };
  }, [embedded]);
  return context;
}
export function useColorScheme(embedded: boolean, context: HostContext | null) {
  const [system, setSystem] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  const scheme = embedded ? context?.theme.colorScheme || 'light' : system;
  useEffect(() => { document.documentElement.dataset.colorScheme = scheme; }, [scheme]);
  return scheme;
}
