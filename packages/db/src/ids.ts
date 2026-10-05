import { randomFillSync } from "node:crypto";

/**
 * UUIDv7 (RFC 9562 §5.7) generation for application-level identifiers.
 *
 * Why UUIDv7 (docs/DATABASE_DESIGN.md §2, milestone decision 1):
 *   * time-ordered → index locality and sortable ids;
 *   * client-generatable → a retrying writer can reuse the same id, which is
 *     the foundation of idempotent inserts;
 *   * opaque → no auto-increment sequence leakage.
 *
 * Prisma/PostgreSQL have no built-in UUIDv7 generator, so generation lives at
 * the application boundary in this small, tested utility. The database stores
 * plain `uuid` columns and never generates ids itself.
 *
 * Layout: 48-bit big-endian unix_ts_ms | 4-bit version (0111) |
 *         12-bit monotonic rand_a | 62-bit variant + random payload.
 *
 * Monotonicity: ids generated within the same millisecond increment the
 * 12-bit `rand_a` field, so generation order == lexicographic order even
 * inside one millisecond (overflow advances the millisecond by one).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastGeneratedMs = -1;
let lastRandA = 0;

function fillRandomBytes(buffer: Buffer): void {
  randomFillSync(buffer);
}

function formatUuid(buffer: Buffer): string {
  const hex = buffer.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a new UUIDv7.
 *
 * @param now milliseconds since the Unix epoch; injectable for tests.
 */
export function newUuidv7(now: number = Date.now()): string {
  if (!Number.isFinite(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError(`timestamp out of UUIDv7 range: ${now}`);
  }

  let timestamp = Math.floor(now);
  let randA: number;

  if (timestamp === lastGeneratedMs) {
    randA = (lastRandA + 1) & 0x0fff;
    if (randA === 0) {
      // 12-bit space exhausted inside one millisecond; borrow from the future.
      timestamp += 1;
    }
  } else if (timestamp < lastGeneratedMs) {
    // Clock moved backwards: keep ids strictly increasing.
    timestamp = lastGeneratedMs;
    randA = (lastRandA + 1) & 0x0fff;
    if (randA === 0) timestamp += 1;
  } else {
    randA = 0;
  }

  lastGeneratedMs = timestamp;
  lastRandA = randA;

  const bytes = Buffer.alloc(16);
  fillRandomBytes(bytes);

  // 48-bit big-endian timestamp.
  bytes.writeUInt32BE(Math.floor(timestamp / 0x1_0000), 0);
  bytes.writeUInt16BE(timestamp & 0xffff, 4);
  // version 7 in the high nibble of byte 6; rand_a fills the low 12 bits.
  bytes[6] = 0x70 | ((randA >> 8) & 0x0f);
  bytes[7] = randA & 0xff;
  // variant 10xx in byte 8.
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  return formatUuid(bytes);
}

/** True when the value is a canonical UUID with version 7 and variant 10xx. */
export function isUuidv7(value: string): boolean {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return false;
  const normalized = value.toLowerCase();
  if (normalized[14] !== "7") return false;
  const variantNibble = normalized[19]!;
  return variantNibble === "8" || variantNibble === "9" || variantNibble === "a" || variantNibble === "b";
}

/** True when the value is any canonical UUID (v1–v5, v6–v8 included). */
export function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Embedded creation timestamp (unix milliseconds) of a UUIDv7.
 * Throws RangeError when the value is not a UUIDv7.
 */
export function uuidv7TimestampMs(value: string): number {
  if (!isUuidv7(value)) {
    throw new RangeError(`not a UUIDv7: ${value}`);
  }
  const hex = value.toLowerCase().replace(/-/g, "");
  return Number(BigInt(`0x${hex.slice(0, 12)}`));
}

/**
 * Total order over UUIDv7 values: lexicographic comparison of canonical
 * lowercase form equals time order (generation is monotonic).
 */
export function compareUuidv7(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
