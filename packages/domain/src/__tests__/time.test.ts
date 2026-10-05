import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays,
  assertValidTimezone,
  calendarDaysBetween,
  endOfLocalDayExclusive,
  isValidTimezone,
  startOfLocalDay,
  toUserLocalDate,
} from "../time";

test("isValidTimezone accepts IANA identifiers and rejects others", () => {
  assert.equal(isValidTimezone("Asia/Kolkata"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone("Not/AZone"), false);
  assert.equal(isValidTimezone("GMT+05:30"), false);
});

test("assertValidTimezone throws RangeError for invalid identifiers", () => {
  assert.equal(assertValidTimezone("Europe/Berlin"), "Europe/Berlin");
  assert.throws(() => assertValidTimezone("Mars/Olympus"), RangeError);
});

test("toUserLocalDate maps instants onto the user's local day", () => {
  // 20:00Z is already the next day in UTC+5:30.
  assert.equal(toUserLocalDate("2026-01-15T20:00:00Z", "Asia/Kolkata"), "2026-01-16");
  assert.equal(toUserLocalDate("2026-01-15T20:00:00Z", "UTC"), "2026-01-15");
  // New York is behind UTC.
  assert.equal(toUserLocalDate("2026-01-15T20:00:00Z", "America/New_York"), "2026-01-15");

  // Kolkata day boundary is 18:30 UTC (half-hour offset).
  assert.equal(toUserLocalDate("2026-01-15T18:29:59Z", "Asia/Kolkata"), "2026-01-15");
  assert.equal(toUserLocalDate("2026-01-15T18:30:00Z", "Asia/Kolkata"), "2026-01-16");

  assert.throws(() => toUserLocalDate("not-a-date", "UTC"), RangeError);
  assert.throws(() => toUserLocalDate("2026-01-15T00:00:00Z", "Bad/Zone"), RangeError);
});

test("startOfLocalDay returns the true first instant of a local day", () => {
  assert.equal(startOfLocalDay("2026-08-25", "UTC"), "2026-08-25T00:00:00.000Z");
  assert.equal(startOfLocalDay("2026-08-25", "Asia/Kolkata"), "2026-08-24T18:30:00.000Z");
  // Winter (EST, UTC-5).
  assert.equal(startOfLocalDay("2026-01-15", "America/New_York"), "2026-01-15T05:00:00.000Z");
});

test("DST transitions: spring-forward day lasts 23 hours, fall-back 25", () => {
  // US DST starts 2026-03-08 (02:00 → 03:00 local).
  const springStart = startOfLocalDay("2026-03-08", "America/New_York");
  const springEnd = endOfLocalDayExclusive("2026-03-08", "America/New_York");
  assert.equal(springStart, "2026-03-08T05:00:00.000Z");
  assert.equal(springEnd, "2026-03-09T04:00:00.000Z");
  assert.equal(
    (Date.parse(springEnd) - Date.parse(springStart)) / 3_600_000,
    23,
    "spring-forward day is 23h",
  );

  // US DST ends 2026-11-01 (02:00 → 01:00 local).
  const fallStart = startOfLocalDay("2026-11-01", "America/New_York");
  const fallEnd = endOfLocalDayExclusive("2026-11-01", "America/New_York");
  assert.equal(fallStart, "2026-11-01T04:00:00.000Z");
  assert.equal(fallEnd, "2026-11-02T05:00:00.000Z");
  assert.equal(
    (Date.parse(fallEnd) - Date.parse(fallStart)) / 3_600_000,
    25,
    "fall-back day is 25h",
  );
});

test("startOfLocalDay round-trips through toUserLocalDate", () => {
  const cases: Array<[string, string]> = [
    ["2026-08-25", "UTC"],
    ["2026-08-25", "Asia/Kolkata"],
    ["2026-01-15", "America/New_York"],
    ["2026-03-08", "America/New_York"],
    ["2026-11-01", "America/New_York"],
    ["2026-12-31", "Australia/Sydney"],
    ["2026-02-28", "Pacific/Kiritimati"],
  ];
  for (const [date, timezone] of cases) {
    const start = startOfLocalDay(date, timezone);
    assert.equal(toUserLocalDate(start, timezone), date, `${date} @ ${timezone}`);
    // One millisecond before the day starts still belongs to the previous day.
    const previous = toUserLocalDate(new Date(Date.parse(start) - 1), timezone);
    assert.notEqual(previous, date, `${date} @ ${timezone} previous instant`);
  }
});

test("addCalendarDays handles month, year and leap boundaries", () => {
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2026-08-25", 0), "2026-08-25");
  assert.throws(() => addCalendarDays("2026-13-01", 1), RangeError);
  assert.throws(() => addCalendarDays("2026-02-30", 1), RangeError);
});

test("calendarDaysBetween is inclusive and ordered", () => {
  assert.deepEqual(calendarDaysBetween("2026-08-30", "2026-09-01"), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ]);
  assert.deepEqual(calendarDaysBetween("2026-08-30", "2026-08-30"), ["2026-08-30"]);
  assert.deepEqual(calendarDaysBetween("2026-09-01", "2026-08-30"), []);
});
