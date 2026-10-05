import type { BaseEntity, CalendarDate, UserId } from "./shared";

export type GoalKind =
  | "bodybuilding"
  | "aesthetics_v_taper"
  | "lean_recomposition"
  | "athletic_performance"
  | "max_strength"
  | "general_fitness"
  | "custom";

/**
 * Free-form focus tags ranked by the user, e.g. "shoulder_width",
 * "waist_control". Kept as strings so custom priorities do not require
 * schema churn.
 */
export type GoalPriorityTag = string;

/**
 * Explicit physique targets. Absent fields mean "no explicit target yet";
 * zero is never a valid target value for a circumference.
 */
export interface PhysiqueTarget {
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  waistCm?: number;
  chestCm?: number;
  shoulderCircumferenceCm?: number;
  armCm?: number;
  thighCm?: number;
  calfCm?: number;
  notes?: string;
}

export interface Goal extends BaseEntity {
  userId: UserId;
  kind: GoalKind;
  description?: string;
  /** Ordered most-important-first. */
  priorities: readonly GoalPriorityTag[];
  physiqueTarget?: PhysiqueTarget;
  effectiveFrom: CalendarDate;
  effectiveUntil?: CalendarDate;
}
