/** Canonical naming with explicit read compatibility for existing installations. */
export const brand = 'dsh-langgraph-canvas';
export const previousBrands = Object.freeze(['langcontour', 'vis4agent']);
export const configurationNames = [brand, ...previousBrands].map(name => '__' + name.replaceAll('-', '_').toUpperCase() + '_CONFIG__');
export function environmentValue(name, env = process.env) {
  for (const prefix of ['DSH_LANGGRAPH_CANVAS_', 'LANGCONTOUR_', 'VIS4AGENT_']) {
    const value = env[prefix + name]?.trim(); if (value) return value;
  }
  return undefined;
}
export function behaviorMarker(directoryName) {
  for (const name of [brand, ...previousBrands]) if (directoryName.startsWith(name + '-behavior-')) return '.' + name + '-owner.json';
  return undefined;
}
export function hostTaskMatches(value, id) { return [brand, ...previousBrands].some(name => value === name + '-' + id); }
