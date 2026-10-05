import type {
  BaseEntity,
  CalendarDate,
  EffortLevel,
  EntityId,
  ExerciseId,
  Timestamp,
  TrainingPlanId,
  UserId,
} from "./shared";

export type PlanStatus = "draft" | "active" | "paused" | "retired";

export interface RepRange {
  min: number;
  max: number;
}

/** One planned exercise within a session template. */
export interface ExerciseSlot {
  id: EntityId;
  exerciseId: ExerciseId;
  targetSets: number;
  targetRepRange?: RepRange;
  /** Reps in reserve target for the working sets. */
  targetRir?: number;
  restSeconds?: number;
  substitutionExerciseIds?: readonly ExerciseId[];
  notes?: string;
}

export interface SessionTemplate {
  id: EntityId;
  name: string;
  /** Advisory hint only (0 = Sunday .. 6 = Saturday); real scheduling may differ. */
  weekdayHint?: number;
  slots: readonly ExerciseSlot[];
}

export interface TrainingPlan extends BaseEntity {
  userId: UserId;
  name: string;
  status: PlanStatus;
  startsOn: CalendarDate;
  endsOn?: CalendarDate;
  sessionsPerWeek: number;
  sessionTemplates: readonly SessionTemplate[];
  notes?: string;
}

export type SetKind = "warmup" | "working" | "drop_set" | "rest_pause" | "amrap" | "failure";

/**
 * A single logged set. Load semantics: loadKg is the total external load
 * moved; addedLoadKg records extra load attached to bodyweight movements
 * (e.g. weighted pull-ups). Distance/duration apply to conditioning work.
 */
export interface ExerciseSet {
  id: EntityId;
  exerciseId: ExerciseId;
  kind: SetKind;
  loadKg?: number;
  addedLoadKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rir?: number;
  rpe?: number;
  notes?: string;
}

export type CardioModality =
  | "walk"
  | "run"
  | "cycle"
  | "row"
  | "swim"
  | "elliptical"
  | "stairs"
  | "sport"
  | "other";

/** Cardio performed as part of a workout session. */
export interface CardioEntry {
  id: EntityId;
  modality: CardioModality;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  intensity?: EffortLevel;
  notes?: string;
}

export type WorkoutStatus = "planned" | "in_progress" | "completed" | "partial" | "skipped";

export interface Workout extends BaseEntity {
  userId: UserId;
  planId?: TrainingPlanId;
  sessionTemplateId?: EntityId;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: WorkoutStatus;
  title?: string;
  sets: readonly ExerciseSet[];
  cardio?: readonly CardioEntry[];
  notes?: string;
}
