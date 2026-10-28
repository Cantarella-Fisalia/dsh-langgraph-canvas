/** Canonical naming with explicit read compatibility for existing installations. */
export const brand = 'langcontour';
export const previousBrand = 'vis4agent';
export function environmentValue(name, env = process.env) {
  return env['LANGCONTOUR_' + name]?.trim() || env['VIS4AGENT_' + name]?.trim();
}
export function behaviorMarker(directoryName) {
  for (const name of [brand, previousBrand]) if (directoryName.startsWith(name + '-behavior-')) return '.' + name + '-owner.json';
  return undefined;
}
export function hostTaskMatches(value, id) { return [brand, previousBrand].some(name => value === name + '-' + id); }
