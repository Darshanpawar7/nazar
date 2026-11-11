import type { Adaptation } from './types';

/**
 * Argument and state checks. Configuration errors throw a RangeError that names the detector and the
 * setting, because a misconfigured detector should fail loudly at construction, not quietly in production.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fail(subject: string, message: string): never {
  throw new RangeError(`${subject}: ${message}`);
}

export function positive(subject: string, name: string, value: unknown): number {
  if (!isFiniteNumber(value) || value <= 0) fail(subject, `${name} must be a positive number, got ${String(value)}`);
  return value;
}

export function nonNegative(subject: string, name: string, value: unknown): number {
  if (!isFiniteNumber(value) || value < 0) fail(subject, `${name} must be zero or more, got ${String(value)}`);
  return value;
}

export function fraction(subject: string, name: string, value: unknown): number {
  if (!isFiniteNumber(value) || value <= 0 || value >= 1) {
    fail(subject, `${name} must be between 0 and 1 (exclusive), got ${String(value)}`);
  }
  return value;
}

export function integer(subject: string, name: string, value: unknown, min: number, max = 1e7): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(subject, `${name} must be a whole number from ${min} to ${max}, got ${String(value)}`);
  }
  return value as number;
}

export function adaptation(subject: string, value: unknown): Adaptation {
  if (value === 'normal-only' || value === 'always' || value === 'never') return value;
  return fail(subject, `adapt must be "normal-only", "always" or "never", got ${String(value)}`);
}

export function oneOf<T extends string>(subject: string, name: string, value: unknown, options: readonly T[]): T {
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T;
  return fail(
    subject,
    `${name} must be one of ${options.map(option => `"${option}"`).join(', ')}, got ${String(value)}`,
  );
}

// ---- reading saved state, which may come from anywhere ----

const MAX_ARRAY = 1_000_000;

/** A plain object (not an array, not null), with own keys only. */
export function record(subject: string, value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(subject, 'expected an object');
  return value as Record<string, unknown>;
}

function own(source: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

export function readNumber(subject: string, source: Readonly<Record<string, unknown>>, key: string): number {
  const value = own(source, key);
  if (!isFiniteNumber(value)) fail(subject, `state.${key} must be a finite number`);
  return value;
}

export function readCount(subject: string, source: Readonly<Record<string, unknown>>, key: string): number {
  const value = own(source, key);
  if (!Number.isInteger(value) || (value as number) < 0) fail(subject, `state.${key} must be a whole number`);
  return value as number;
}

export function readNumbers(
  subject: string,
  source: Readonly<Record<string, unknown>>,
  key: string,
  maxLength = MAX_ARRAY,
): number[] {
  const value = own(source, key);
  if (!Array.isArray(value) || value.length > maxLength || !value.every(isFiniteNumber)) {
    fail(subject, `state.${key} must be an array of at most ${maxLength} finite numbers`);
  }
  return [...(value as number[])];
}

/** Reads an optional config value, falling back to a default when it is absent. */
export function option<T>(config: object | undefined, key: string, fallback: T): unknown {
  if (config === undefined || config === null) return fallback;
  const value = own(config as Record<string, unknown>, key);
  return value === undefined ? fallback : value;
}
