import type { BaseEntity, CalendarDate } from "./shared";

export type Sex = "male" | "female" | "intersex" | "undisclosed";

export type TrainingExperience = "untrained" | "beginner" | "intermediate" | "advanced";

/**
 * Display preference only. All stored quantities use SI units
 * (kg, cm, ml); conversion happens at the presentation edge.
 */
export type UnitSystem = "metric" | "imperial";

/**
 * Personal characteristics relevant to training and nutrition math.
 * Optional fields are filled in progressively during onboarding and later.
 */
export interface Profile {
  birthDate?: CalendarDate;
  sex?: Sex;
  heightCm?: number;
  trainingExperience?: TrainingExperience;
  /** Days per week the user is able/willing to train. */
  trainingDaysPerWeek?: number;
  /** Typical available session length in minutes. */
  sessionDurationMinutes?: number;
  /** Injuries or limitations that constrain exercise selection. Free-form until modeled. */
  limitations?: readonly string[];
  unitSystem?: UnitSystem;
}

export interface User extends BaseEntity {
  /** Present once an identity/auth strategy exists; deliberately optional now. */
  externalAuthId?: string;
  displayName?: string;
  email?: string;
  /**
   * IANA timezone identifier (e.g. "Asia/Kolkata") defining the user's local
   * day. Every daily concept — meals, steps, workouts, nutrition snapshots,
   * weekly aggregation — uses this boundary, never UTC.
   */
  timezone: string;
  profile: Profile;
}
