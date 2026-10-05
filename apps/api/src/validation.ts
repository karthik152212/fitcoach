import { isUuid } from "@fitcoach/db";

/**
 * Request validation (milestone §12). Fail-fast: the first violation throws
 * with a JSON path, and the error mapper renders it as a 400 response.
 *
 * Messages describe the rule, never the submitted value — request bodies can
 * contain health data and must not leak into error responses or logs.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export class RequestValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "RequestValidationError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new RequestValidationError(path, message);
}

/**
 * Helpers take the *display path* as their key so error envelopes can say
 * `servings[0].label`. Nested mappers address items directly, so the lookup
 * uses only the final segment — field names in this API never contain dots.
 */
function fieldOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? key : key.slice(dot + 1);
}

export function asObject(value: unknown, path = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function has(obj: Record<string, unknown>, key: string): boolean {
  const field = fieldOf(key);
  return (
    Object.prototype.hasOwnProperty.call(obj, field) &&
    obj[field] !== undefined &&
    obj[field] !== null
  );
}

export function requiredString(
  obj: Record<string, unknown>,
  key: string,
  options: { minLength?: number; maxLength?: number } = {},
): string {
  const value = obj[fieldOf(key)];
  if (typeof value !== "string" || value.length === 0) fail(key, "must be a non-empty string");
  if (options.minLength !== undefined && value.length < options.minLength) {
    fail(key, `must be at least ${options.minLength} characters`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    fail(key, `must be at most ${options.maxLength} characters`);
  }
  return value;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string | undefined {
  if (!has(obj, key)) return undefined;
  const value = obj[fieldOf(key)];
  if (typeof value !== "string") fail(key, "must be a string");
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    fail(key, `must be at most ${options.maxLength} characters`);
  }
  return value;
}

function coerceNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[fieldOf(key)];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    fail(key, "must be a number");
  }
  return undefined;
}

export function requiredNumber(
  obj: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const value = coerceNumber(obj, key);
  if (value === undefined) fail(key, "is required and must be a number");
  return checkNumber(value, key, options);
}

export function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (!has(obj, key)) return undefined;
  const value = coerceNumber(obj, key);
  if (value === undefined) fail(key, "must be a number");
  return checkNumber(value, key, options);
}

function checkNumber(
  value: number,
  key: string,
  options: { min?: number; max?: number; integer?: boolean },
): number {
  if (!Number.isFinite(value)) fail(key, "must be a finite number");
  if (options.integer && !Number.isInteger(value)) fail(key, "must be an integer");
  if (options.min !== undefined && value < options.min) fail(key, `must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max) fail(key, `must be <= ${options.max}`);
  return value;
}

export function requiredEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = obj[fieldOf(key)];
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(key, `must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  if (!has(obj, key)) return undefined;
  return requiredEnum(obj, key, values);
}

export function requiredDate(
  obj: Record<string, unknown>,
  key: string,
): string {
  const value = obj[fieldOf(key)];
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    fail(key, "must be a calendar date (YYYY-MM-DD)");
  }
  return value;
}

export function optionalDate(obj: Record<string, unknown>, key: string): string | undefined {
  if (!has(obj, key)) return undefined;
  return requiredDate(obj, key);
}

export function requiredTimestamp(obj: Record<string, unknown>, key: string): string {
  const value = obj[fieldOf(key)];
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fail(key, "must be an ISO-8601 timestamp");
  }
  return new Date(value).toISOString();
}

export function optionalTimestamp(obj: Record<string, unknown>, key: string): string | undefined {
  if (!has(obj, key)) return undefined;
  return requiredTimestamp(obj, key);
}

export function requiredUuid(obj: Record<string, unknown>, key: string): string {
  const value = obj[fieldOf(key)];
  if (typeof value !== "string" || !isUuid(value)) fail(key, "must be a UUID");
  return value;
}

export function optionalUuid(obj: Record<string, unknown>, key: string): string | undefined {
  if (!has(obj, key)) return undefined;
  return requiredUuid(obj, key);
}

export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  if (!has(obj, key)) return undefined;
  const value = obj[fieldOf(key)];
  if (typeof value !== "boolean") fail(key, "must be a boolean");
  return value;
}

export function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
  options: { maxLength?: number; maxItems?: number } = {},
): string[] | undefined {
  if (!has(obj, key)) return undefined;
  const value = obj[fieldOf(key)];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(key, "must be an array of strings");
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    fail(key, `must contain at most ${options.maxItems} items`);
  }
  const maxItemLength = options.maxLength;
  if (
    maxItemLength !== undefined &&
    value.some((item) => (item as string).length > maxItemLength)
  ) {
    fail(key, `each item must be at most ${maxItemLength} characters`);
  }
  return value as string[];
}

export function optionalPlainObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  if (!has(obj, key)) return undefined;
  const value = obj[fieldOf(key)];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(key, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function optionalObjectArray(
  obj: Record<string, unknown>,
  key: string,
  options: { maxItems?: number } = {},
): Record<string, unknown>[] | undefined {
  if (!has(obj, key)) return undefined;
  const value = obj[fieldOf(key)];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    fail(key, "must be an array of objects");
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    fail(key, `must contain at most ${options.maxItems} items`);
  }
  return value as Record<string, unknown>[];
}

/** Numeric map with per-entry range checks (e.g. circumferences). */
export function optionalNumericMap(
  obj: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): Record<string, number> | undefined {
  const value = optionalPlainObject(obj, key);
  if (value === undefined) return undefined;
  const result: Record<string, number> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "number" || !Number.isFinite(entryValue)) {
      fail(`${key}.${entryKey}`, "must be a number");
    }
    if (options.min !== undefined && entryValue < options.min) {
      fail(`${key}.${entryKey}`, `must be >= ${options.min}`);
    }
    if (options.max !== undefined && entryValue > options.max) {
      fail(`${key}.${entryKey}`, `must be <= ${options.max}`);
    }
    result[entryKey] = entryValue;
  }
  return result;
}
