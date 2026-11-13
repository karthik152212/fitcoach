import type { PlanVersion, PlanVersionSession } from "../api/types";

/**
 * Schedule helpers: map plan sessions onto the user's week.
 * Pure presentation logic — the plan content itself always comes from the engine.
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayLabel(index: number): string {
  return WEEKDAYS[index] ?? "";
}

/** The session planned for a weekday (0–6, JS convention), if any. */
export function sessionForWeekday(version: PlanVersion | undefined, weekday: number): PlanVersionSession | undefined {
  if (!version) return undefined;
  return version.sessions.find((session) => session.weekdayHint === weekday);
}

export function todaySessionOf(version: PlanVersion | undefined, date = new Date()): PlanVersionSession | undefined {
  return sessionForWeekday(version, date.getDay());
}

export interface WeekDayCell {
  weekday: number;
  label: string;
  session?: PlanVersionSession;
  state: "today" | "completed" | "missed" | "adapted" | "planned" | "rest";
}

/**
 * Build the 7-day week strip. Completion states come from recorded workouts
 * (matched by weekday within the current week), never assumed.
 */
export function buildWeekCells(
  version: PlanVersion | undefined,
  workouts: readonly { startedAt: string; status: string; sessionClassification?: string }[],
  now = new Date(),
): WeekDayCell[] {
  const mondayOffset = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);

  return [1, 2, 3, 4, 5, 6, 0].map((weekday, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    const session = sessionForWeekday(version, weekday);
    const isToday = day.toDateString() === now.toDateString();
    const isPast = day.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const performed = workouts.find((workout) => {
      const started = new Date(workout.startedAt);
      return started.toDateString() === day.toDateString() && workout.status === "completed";
    });

    let state: WeekDayCell["state"];
    if (!session) state = "rest";
    else if (performed?.sessionClassification === "adapted") state = "adapted";
    else if (performed) state = "completed";
    else if (isToday) state = "today";
    else if (isPast) state = "missed";
    else state = "planned";

    return { weekday, label: WEEKDAYS[weekday] ?? "", session, state };
  });
}
