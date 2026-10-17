import type { FunctionParameter, ResourceFunction } from '@registry/types';

export const LAMPORTS_PER_SOL = 1_000_000_000;

const lamportFormat = new Intl.NumberFormat('en-US');
const solFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 9 });

export const formatLamports = (lamports: number) => `${lamportFormat.format(lamports)} lamports`;

export const formatSol = (lamports: number) => `${solFormat.format(lamports / LAMPORTS_PER_SOL)} SOL`;

/** "12s ago", "3m ago", "5h ago", "2d ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const formatDate = (iso: string) => `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)}Z`;

/** `temperature(city: string): int32` */
export const signature = (fn: ResourceFunction) =>
  `${fn.name}(${fn.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${fn.returnType}`;

/** A placeholder argument of the parameter's RequestScript type. */
function exampleValue(parameter: FunctionParameter): string {
  const type = parameter.type.toLowerCase();
  if (type === 'string') return `"${parameter.name}"`;
  if (type.startsWith('int') || type.startsWith('uint')) return '0';
  if (type.startsWith('float') || type === 'double') return '0.0';
  if (type === 'boolean' || type === 'bool') return 'false';
  return 'null';
}

const pascal = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** A RequestScript request that calls one function. */
export function requestScriptExample(path: string, name: string, fn: ResourceFunction): string {
  const binding = name.charAt(0).toLowerCase() + name.slice(1);
  const args = fn.parameters.map((p) => `${p.name}: ${exampleValue(p)}`).join(', ');
  return [
    `request ${pascal(name)}${pascal(fn.name)} {`,
    `  const ${binding}: ${path}.${name}`,
    '',
    `  const result = ${binding}.${fn.name}(${args})`,
    '  if (result.error != null) {',
    '    return result.error.message',
    '  }',
    '',
    '  return result.value',
    '}',
  ].join('\n');
}

/** The `Capability` a grant for exactly this function would carry (stellarium-ts `grant/grant.ts`). */
export const capabilityExample = (path: string, name: string, fn: ResourceFunction) =>
  JSON.stringify({ resourcePath: path, resourceName: name, functionName: fn.name }, null, 2);
