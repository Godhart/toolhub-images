import type { TSchema } from '@sinclair/typebox';

// TypeBox object schemas are closed by default in TWYLT. Clone recursively so
// nested declared objects publish and enforce additionalProperties:false.
export function closeSchema<T extends TSchema>(schema: T): T {
  const clone = structuredClone(schema) as Record<string, unknown>;
  closeNode(clone);
  return clone as T;
}

function closeNode(node: unknown): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' || obj.properties) obj.additionalProperties = false;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'additionalProperties') continue;
    if (Array.isArray(value)) value.forEach(closeNode);
    else closeNode(value);
  }
}

export function withIdentity<T extends TSchema>(schema: T, name?: string, version?: string): T {
  const result = closeSchema(schema) as T & Record<string, unknown>;
  if (name) result.$id = name;
  if (version) (result as Record<string, unknown>)['x-schema-version'] = version;
  return result;
}
