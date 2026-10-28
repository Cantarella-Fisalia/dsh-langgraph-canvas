import { previousBrand } from '../../../scripts/runtime/brand.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { useHostContext, useColorScheme } from './host.ts';
import './styles.css';

const parameters = new URLSearchParams(location.search);
// Standalone build can be served under the Harness origin by its adapter.
const config = (window as any).__LANGCONTOUR_CONFIG__ || (window as any)['__' + previousBrand.toUpperCase() + '_CONFIG__'] || {};
const embedded = parameters.get('embedded') === '1';
function Workbench() {
  const context = useHostContext(embedded);
  const colorScheme = useColorScheme(embedded, context);
  return <App apiBase={config.apiBase || parameters.get('apiBase') || '/api/v1'}
    sessionId={context?.sessionId ?? null} embedded={embedded} workspaceRoot={context?.workspaceRoot ?? null} colorScheme={colorScheme} />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Workbench /></React.StrictMode>,
);
