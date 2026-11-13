import type { BaseEntity, CalendarDate, EffortLevel, Timestamp, UserId, ObservationOrigin, ConfidenceLevel } from "./shared";
import type { CardioModality } from "./training";

/** Circumference measurement sites. Paired sites are recorded separately. */
export type BodySite =
  | "neck"
  | "shoulders"
  | "chest"
  | "waist"
  | "hips"
  | "left_upper_arm"
  | "right_upper_arm"
  | "left_thigh"
  | "right_thigh"
  | "left_calf"
  | "right_calf";

export type MeasurementCondition =
  | "morning_fasted"
  | "post_workout"
  | "evening"
  | "random"
  | "other";

/**
 * A single measurement session: mass in kg, circumferences in cm.
 * Single readings are noisy; all trend conclusions must be computed over
 * multiple records (PRODUCT_SPEC coaching principle 4).
 */
export interface BodyMeasurement extends BaseEntity {
  userId: UserId;
  recordedAt: Timestamp;
  /** Context that affects comparability between records. */
  condition?: MeasurementCondition;
  bodyWeightKg?: number;
  circumferencesCm?: Readonly<Partial<Record<BodySite, number>>>;
  bodyFatPercent?: number;
  /** References to stored photos; binaries live outside the domain model. */
  photoRefs?: readonly string[];
  notes?: string;
}

/**
 * Daily activity. kind="steps" is a day-level aggregate (total steps);
 * every other kind is a discrete activity session on that day.
 *
 * Activity targets are contextual (body, calories, training, recovery, goal):
 * a raw step count carries no inherent goodness (PRODUCT_SPEC principle 2).
 */
export type ActivityKind = "steps" | CardioModality;

export interface ActivityRecord extends BaseEntity {
  userId: UserId;
  /** User-local calendar day this record belongs to. */
  date: CalendarDate;
  kind: ActivityKind;
  /** Only meaningful for kind="steps": total steps for the day. */
  steps?: number;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: EffortLevel;
  /** Where the record came from (manual entry, wearable, import, ...). */
  recordedVia?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Sleep observations
// ---------------------------------------------------------------------------

/** Sleep stage breakdown (minutes). */
export interface SleepStages {
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  awakeMinutes?: number;
}

/**
 * One night of sleep, observed from a platform health framework, wearable,
 * or manual entry. Append-only: corrections add new rows.
 */
export interface SleepObservation extends BaseEntity {
  userId: UserId;
  /** User-local calendar day this sleep belongs to (the "night of"). */
  date: CalendarDate;
  /** When the sleep period started (UTC). */
  startedAt: Timestamp;
  /** When the sleep period ended (UTC). */
  endedAt: Timestamp;
  /** Total time in bed, minutes. */
  timeInBedMinutes?: number;
  /** Total asleep time, minutes. */
  asleepMinutes?: number;
  /** Sleep efficiency percentage (asleep / time_in_bed * 100). */
  efficiency?: number;
  /** Sleep latency: minutes to fall asleep. */
  latencyMinutes?: number;
  /** Sleep stage breakdown. */
  stages?: SleepStages;
  /** Number of awakenings. */
  awakenings?: number;
  /** Platform/framework this observation came from. */
  source: ObservationOrigin;
  /** Provider event id for import dedupe. */
  externalId?: string;
  /** Qualitative trust level. */
  confidence: ConfidenceLevel;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Recovery indicators
// ---------------------------------------------------------------------------

/**
 * Subjective and physiological recovery indicators recorded for a day.
 * Append-only: new readings add rows.
 */
export interface RecoveryIndicator extends BaseEntity {
  userId: UserId;
  /** User-local calendar day. */
  date: CalendarDate;
  /** Heart rate variability, ms (RMSSD or SDNN). */
  hrvMs?: number;
  /** Resting heart rate, bpm. */
  restingHeartRateBpm?: number;
  /** Platform sleep score (0-100). */
  sleepScore?: number;
  /** Platform readiness/recovery score (0-100). */
  readinessScore?: number;
  /** Subjective muscle soreness (1-10). */
  muscleSoreness?: number;
  /** Subjective fatigue (1-10). */
  fatigue?: number;
  /** Subjective sleep quality (1-10). */
  sleepQuality?: number;
  /** Subjective readiness to train (1-10). */
  readinessSubjective?: number;
  /** Platform/framework this observation came from. */
  source: ObservationOrigin;
  /** Provider event id for import dedupe. */
  externalId?: string;
  /** Qualitative trust level. */
  confidence: ConfidenceLevel;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Computed aggregates (output types for engines)
// ---------------------------------------------------------------------------

/** Daily activity summary aggregated from steps + discrete sessions. */
export interface DailyActivitySummary {
  /** User-local calendar day. */
  date: CalendarDate;
  /** Total steps for the day. */
  steps: number;
  /** Active minutes (cardio + training + other moderate+ effort). */
  activeMinutes: number;
  /** Cardio minutes (walk/run/cycle/row/swim/elliptical/stairs/sport). */
  cardioMinutes: number;
  /** Training minutes (from completed workouts). */
  trainingMinutes: number;
  /** Estimated energy expenditure kcal (activity + training). */
  estimatedEeKcal: number;
  /** Discrete sessions contributing to this day. */
  sessions: readonly ActivityRecord[];
}

/** Personalized activity targets derived from context. */
export interface ActivityTargets {
  /** Recommended daily steps target. */
  dailyStepsTarget: number;
  /** Recommended weekly cardio minutes target. */
  weeklyCardioMinTarget: number;
  /** Recommended weekly active minutes target (cardio + training). */
  weeklyActiveMinTarget: number;
  /** Human-readable explanation of how targets were derived. */
  basisNote: string;
}

/** Computed recovery state from sleep + indicators + training load + nutrition. */
export interface RecoveryState {
  /** Overall readiness 0-100. */
  readinessScore: number;
  /** Confidence in the readiness score (0-1). */
  confidence: number;
  /** Sleep quality trend: "improving" | "stable" | "declining" | "unknown". */
  sleepQualityTrend: string;
  /** Sleep adequacy: whether recent sleep meets need. */
  sleepAdequacy: "adequate" | "moderate_debt" | "severe_debt";
  /** HRV trend: "improving" | "stable" | "declining" | "unknown". */
  hrvTrend: string;
  /** Fatigue accumulation level. */
  fatigueAccumulation: "low" | "moderate" | "high" | "very_high";
  /** Limiting factors identified. */
  limitingFactors: readonly string[];
  /** Training recommendation: "maintain" | "reduce_volume" | "reduce_intensity" | "delay" | "active_recovery". */
  trainingRecommendation: string;
  /** Nutrition recommendation hints. */
  nutritionRecommendations: readonly string[];
  /** Activity recommendation hints. */
  activityRecommendations: readonly string[];
  /** Human-readable explanation of how state was derived. */
  basisNote: string;
}
