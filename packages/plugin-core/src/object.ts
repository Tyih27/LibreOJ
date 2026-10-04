export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => deepClone(item)) as unknown as T;
  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) clone[key] = deepClone(value[key]);
    return clone as unknown as T;
  }
  return value;
}

/**
 * Recursively merges `override` into `base` without mutating either input. Objects are merged key by key; every other
 * value (including arrays) is replaced wholesale by `override`.
 */
export function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(base)) merged[key] = deepClone(base[key]);
  for (const key of Object.keys(override)) {
    const previous = merged[key];
    const next = override[key];
    merged[key] = isPlainObject(previous) && isPlainObject(next) ? deepMerge(previous, next) : deepClone(next);
  }
  return merged;
}
