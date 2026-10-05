import type { BaseEntity, CalendarDate, EffortLevel, Timestamp, UserId } from "./shared";
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
