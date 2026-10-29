export const brand: 'dsh-langgraph-canvas';
export const previousBrands: readonly ['langcontour', 'vis4agent'];
export const configurationNames: string[];
export function environmentValue(name: string, env?: Record<string, string | undefined>): string | undefined;
export function behaviorMarker(directoryName: string): string | undefined;
export function hostTaskMatches(value: unknown, id: string): boolean;
