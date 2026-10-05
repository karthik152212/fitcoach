import type { CalendarDate, Timestamp } from "./shared";

/**
 * User-local day arithmetic.
 *
 * All "day" concepts in FitCoach (daily meals, daily steps, workouts,
 * nutrition snapshots, weekly aggregation) are USER-LOCAL days defined by an
 * IANA timezone identifier — never UTC derivations at query time
 * (docs/DATABASE_DESIGN.md §2).
 *
 * Pure, deterministic functions over the standard Intl API: no dependencies,
 * no storage, no clock reads except what the caller passes in.
 */

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsFor(timeZone: string, instantMs: number): { year: number; month: number; day: number } {
  const parts = dateFormatterFor(timeZone).formatToParts(new Date(instantMs));
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return { year, month, day };
}

/** True when the string is a syntactically valid IANA timezone identifier. */
export function isValidTimezone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Throws RangeError for invalid identifiers; returns the identifier otherwise. */
export function assertValidTimezone(timeZone: string): string {
  if (!isValidTimezone(timeZone)) {
    throw new RangeError(`invalid IANA timezone identifier: ${String(timeZone)}`);
  }
  return timeZone;
}

function assertCalendarDate(date: string): void {
  if (!CALENDAR_DATE_PATTERN.test(date)) {
    throw new RangeError(`invalid calendar date (expected YYYY-MM-DD): ${date}`);
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`invalid calendar date: ${date}`);
  }
}

function toDate(instant: Timestamp | Date): Date {
  return instant instanceof Date ? instant : new Date(instant);
}

/**
 * The user-local calendar day an instant falls on, as YYYY-MM-DD.
 * Example: 2026-01-15T20:00:00Z in Asia/Kolkata is 2026-01-16.
 */
export function toUserLocalDate(instant: Timestamp | Date, timeZone: string): CalendarDate {
  assertValidTimezone(timeZone);
  const date = toDate(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`invalid timestamp: ${String(instant)}`);
  }
  const { year, month, day } = partsFor(timeZone, date.getTime());
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/** Calendar arithmetic on YYYY-MM-DD (UTC-based, so DST never interferes). */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  assertCalendarDate(date);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * First instant of the given user-local day (ISO-8601 UTC timestamp).
 *
 * Binary search over ±26h around the naive UTC midnight, so DST transitions
 * are handled exactly: on a spring-forward day where local 00:00 does not
 * exist, the result is the transition instant — the true start of that day.
 */
export function startOfLocalDay(date: CalendarDate, timeZone: string): Timestamp {
  assertValidTimezone(timeZone);
  assertCalendarDate(date);
  const naiveUtcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  let low = naiveUtcMidnight - 26 * 3_600_000;
  let high = naiveUtcMidnight + 26 * 3_600_000;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (toUserLocalDate(new Date(mid), timeZone) < date) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return new Date(low).toISOString();
}

/** Exclusive end of the user-local day = start of the following day. */
export function endOfLocalDayExclusive(date: CalendarDate, timeZone: string): Timestamp {
  return startOfLocalDay(addCalendarDays(date, 1), timeZone);
}

/** All user-local days from `from` to `to`, inclusive. */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  assertCalendarDate(from);
  assertCalendarDate(to);
  const days: CalendarDate[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}
