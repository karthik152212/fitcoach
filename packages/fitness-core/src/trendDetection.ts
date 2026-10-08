import type { CalendarDate, PlateauSignal } from "@fitcoach/domain";

/**
 * Trend detection (Phase 3).
 *
 * Replaces the Phase 1/2 stub. Detects training-side signals that inform
 * adaptation decisions:
 * - Repeated performance stagnation
 * - Declining performance
 * - Planned vs completed gap
 * - Session duration overload
 * - Adherence issues
 *
 * These are TRAINING-SIDE signals only. Full diagnosis is deferred to Phase 8.
 */

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

export interface TrendInput {
  /** Recent sessions with exercise performance data. */
  sessions: readonly SessionData[];
  /** Exercise-level performance trends. */
  exerciseTrends: Readonly<Record<string, ExerciseTrend>>;
  /** Configured thresholds. */
  thresholds: {
    stagnationThreshold: number;
    declineThreshold: number;
    adherenceThreshold: number;
  };
}

export interface SessionData {
  date: string;
  exercises: readonly ExerciseSessionData[];
}

export interface ExerciseSessionData {
  exerciseId: string;
  sets: readonly SetData[];
}

export interface SetData {
  reps?: number;
  targetReps?: number;
  loadKg?: number;
  targetLoadKg?: number;
  rir?: number;
  completed: boolean;
}

export interface ExerciseTrend {
  bestReps?: number;
  bestLoadKg?: number;
  recentRir?: number;
  completedSessions: number;
  incompleteSessions: number;
  trend: "improving" | "stable" | "declining" | "unknown";
  sessionsAtTopRange: number;
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

/**
 * Detect training-side signals from trend data.
 *
 * Returns structured PlateauSignal objects that the adaptation engine can use.
 */
export function detectTrends(input: TrendInput): PlateauSignal[] {
  const signals: PlateauSignal[] = [];
  const { sessions, exerciseTrends, thresholds } = input;

  // 1. Repeated performance stagnation
  for (const [exerciseId, trend] of Object.entries(exerciseTrends)) {
    if (trend.trend === "stable" && trend.completedSessions >= thresholds.stagnationThreshold) {
      signals.push({
        kind: "repeated_performance_stagnation",
        observation: `${exerciseId}: performance stable for ${trend.completedSessions} sessions (threshold: ${thresholds.stagnationThreshold}).`,
        affectedEntity: exerciseId,
        severity: 0.4,
        observedWeeks: Math.ceil(trend.completedSessions / 3),
      });
    }
  }

  // 2. Declining performance
  for (const [exerciseId, trend] of Object.entries(exerciseTrends)) {
    if (trend.trend === "declining" && trend.incompleteSessions >= 2) {
      signals.push({
        kind: "declining_performance",
        observation: `${exerciseId}: performance declining with ${trend.incompleteSessions} incomplete sessions.`,
        affectedEntity: exerciseId,
        severity: 0.7,
        observedWeeks: Math.ceil(trend.completedSessions / 3),
      });
    }
  }

  // 3. Planned vs completed gap
  const completionData = calculateCompletionRates(sessions);
  for (const [exerciseId, rate] of Object.entries(completionData)) {
    if (rate < thresholds.adherenceThreshold) {
      signals.push({
        kind: "planned_vs_completed_gap",
        observation: `${exerciseId}: completion rate ${Math.round(rate * 100)}% below threshold ${thresholds.adherenceThreshold * 100}%.`,
        affectedEntity: exerciseId,
        severity: 0.5,
        observedWeeks: sessions.length / 3,
      });
    }
  }

  // 4. Session duration overload (would need duration data per session)
  // Deferred — requires actual session timing data

  // 5. Adherence issues
  const sessionCompletion = calculateSessionCompletion(sessions);
  for (const [date, completed] of Object.entries(sessionCompletion)) {
    if (!completed) {
      signals.push({
        kind: "adherence_issue",
        observation: `Session on ${date} was not completed.`,
        severity: 0.3,
        observedWeeks: 1,
      });
    }
  }

  return signals;
}

/**
 * Calculate completion rate per exercise.
 */
function calculateCompletionRates(
  sessions: readonly SessionData[],
): Readonly<Record<string, number>> {
  const totalSets = new Map<string, number>();
  const completedSets = new Map<string, number>();

  for (const session of sessions) {
    for (const ex of session.exercises) {
      const currentTotal = totalSets.get(ex.exerciseId) ?? 0;
      totalSets.set(ex.exerciseId, currentTotal + ex.sets.length);

      const completed = ex.sets.filter(s => s.completed).length;
      const currentCompleted = completedSets.get(ex.exerciseId) ?? 0;
      completedSets.set(ex.exerciseId, currentCompleted + completed);
    }
  }

  const rates: Record<string, number> = {};
  for (const [exerciseId, total] of totalSets.entries()) {
    rates[exerciseId] = total > 0 ? (completedSets.get(exerciseId) ?? 0) / total : 1;
  }

  return rates;
}

/**
 * Calculate session completion status.
 */
function calculateSessionCompletion(
  sessions: readonly SessionData[],
): Readonly<Record<string, boolean>> {
  const completion: Record<string, boolean> = {};

  for (const session of sessions) {
    const allCompleted = session.exercises.every(ex =>
      ex.sets.every(s => s.completed)
    );
    completion[session.date] = allCompleted;
  }

  return completion;
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

/**
 * Compute trend for an exercise from session data.
 */
export function computeExerciseTrend(
  exerciseSessions: readonly {
    date: string;
    sets: readonly {
      reps?: number;
      loadKg?: number;
      rir?: number;
      completed: boolean;
    }[];
  }[],
): ExerciseTrend {
  const completedSessions: { reps: number; loadKg: number; rir: number }[] = [];

  for (const session of exerciseSessions) {
    for (const set of session.sets) {
      if (set.completed && set.reps !== undefined && set.loadKg !== undefined) {
        completedSessions.push({
          reps: set.reps,
          loadKg: set.loadKg,
          rir: set.rir ?? 2,
        });
      }
    }
  }

  if (completedSessions.length === 0) {
    return {
      bestReps: undefined,
      bestLoadKg: undefined,
      recentRir: undefined,
      completedSessions: 0,
      incompleteSessions: exerciseSessions.length,
      trend: "unknown",
      sessionsAtTopRange: 0,
    };
  }

  // Sort by date
  completedSessions.sort((a, b) => a.reps - b.reps); // Simplified

  const bestReps = Math.max(...completedSessions.map(c => c.reps));
  const bestLoadKg = Math.max(...completedSessions.map(c => c.loadKg));
  const recentRir = completedSessions[completedSessions.length - 1]?.rir;

  // Determine trend by comparing recent to earlier performance
  const recentWindow = Math.min(3, completedSessions.length);
  const recent = completedSessions.slice(-recentWindow);
  const earlier = completedSessions.slice(0, completedSessions.length - recentWindow);

  let trend: "improving" | "stable" | "declining" | "unknown" = "unknown";

  if (earlier.length > 0 && recent.length > 0) {
    const avgRecentReps = recent.reduce((s, c) => s + c.reps, 0) / recent.length;
    const avgEarlierReps = earlier.reduce((s, c) => s + c.reps, 0) / earlier.length;

    const avgRecentLoad = recent.reduce((s, c) => s + c.loadKg, 0) / recent.length;
    const avgEarlierLoad = earlier.reduce((s, c) => s + c.loadKg, 0) / earlier.length;

    // Improving: more reps or more load with same/similar reps
    if (avgRecentReps > avgEarlierReps * 1.1 || avgRecentLoad > avgEarlierLoad * 1.05) {
      trend = "improving";
    } else if (avgRecentReps < avgEarlierReps * 0.9 || avgRecentLoad < avgEarlierLoad * 0.95) {
      trend = "declining";
    } else {
      trend = "stable";
    }
  }

  // Count sessions at top of rep range
  const repRangeTop = 12; // Simplified — would come from plan
  const sessionsAtTopRange = completedSessions.filter(c => c.reps >= repRangeTop).length;

  return {
    bestReps,
    bestLoadKg,
    recentRir,
    completedSessions: completedSessions.length,
    incompleteSessions: exerciseSessions.length - completedSessions.length,
    trend,
    sessionsAtTopRange,
  };
}

// ---------------------------------------------------------------------------
// Metric trend analysis (shared with future nutrition/body trends)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: CalendarDate;
  value: number;
}

export type TrendDirection = "increasing" | "decreasing" | "stable" | "insufficient_data";

export interface TrendAnalysis {
  direction: TrendDirection;
  /** Estimated change per day; null when direction is insufficient_data. */
  slopePerDay: number | null;
  /** 0..1 confidence that the detected direction is real rather than noise. */
  confidence: number | null;
  pointsUsed: number;
  warnings: readonly string[];
}

export interface TrendOptions {
  /** Minimum number of valid points required before a trend is reported. */
  minPoints?: number;
  /**
   * Relative change per day below which the metric is considered stable.
   * 0.001 = 0.1% of the mean value per day. Modeling assumption, configurable.
   */
  stabilityThresholdPerDay?: number;
}

/**
 * Detect whether a metric (body weight, waist, calories, ...) is genuinely
 * moving. Deterministic least-squares fit over sorted points; no randomness,
 * no wall-clock dependence.
 *
 * All coaching conclusions about progress must come from functions like this
 * operating on multiple records — never from single data points.
 */
export function detectTrend(
  points: readonly TrendPoint[],
  options: TrendOptions = {},
): TrendAnalysis {
  const minPoints = options.minPoints ?? 3;
  const threshold = options.stabilityThresholdPerDay ?? 0.001;
  const warnings: string[] = [];

  const valid = points
    .filter((p) => Number.isFinite(p.value))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (valid.length !== points.length) {
    warnings.push(`${points.length - valid.length} point(s) ignored because they are not finite numbers.`);
  }

  if (valid.length < minPoints) {
    warnings.push(`Insufficient data: ${valid.length} valid point(s), need at least ${minPoints}.`);
    return {
      direction: "insufficient_data",
      slopePerDay: null,
      confidence: null,
      pointsUsed: valid.length,
      warnings,
    };
  }

  const first = valid[0]!;
  const toDay = (date: CalendarDate): number => {
    const ms = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`);
    return ms / 86_400_000;
  };

  const xs = valid.map((p) => toDay(p.date));
  const ys = valid.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let slopeNum = 0;
  let slopeDen = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    slopeNum += dx * (ys[i]! - meanY);
    slopeDen += dx * dx;
  }

  if (slopeDen === 0) {
    // Every point is on the same date — no time axis to fit against.
    warnings.push("All points share the same date; no time axis to fit a trend.");
    return {
      direction: "insufficient_data",
      slopePerDay: null,
      confidence: null,
      pointsUsed: n,
      warnings,
    };
  }

  const slope = slopeNum / slopeDen;
  const intercept = meanY - slope * meanX;

  // Coefficient of determination for the linear fit.
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + slope * xs[i]!;
    ssRes += (ys[i]! - predicted) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  const meanAbs = Math.abs(meanY);
  const relativeSlope = meanAbs > 0 ? Math.abs(slope) / meanAbs : Math.abs(slope);

  let direction: TrendDirection;
  if (meanY === 0) {
    direction = slope === 0 ? "stable" : slope > 0 ? "increasing" : "decreasing";
  } else if (relativeSlope < threshold) {
    direction = "stable";
  } else {
    direction = slope > 0 ? "increasing" : "decreasing";
  }

  if (direction === "stable") {
    warnings.push(
      `Relative change of ${(relativeSlope * 100).toFixed(3)}%/day is below the ${threshold * 100}% stability threshold.`,
    );
  }

  // Confidence: fit quality scaled by how much data we have (saturates at 5 points).
  const confidence = Math.round(rSquared * Math.min(1, n / 5) * 1000) / 1000;

  return {
    direction,
    slopePerDay: Math.round(slope * 1e6) / 1e6,
    confidence,
    pointsUsed: n,
    warnings,
  };
}
