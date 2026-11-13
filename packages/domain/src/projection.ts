import type {
  BaseEntity,
  CalendarDate,
  ConfidenceLevel,
  Estimated,
  UserId,
} from "./shared";

/** Projection horizon identifier. */
export type ProjectionHorizon = "current" | "1_month" | "3_months" | "6_months" | "12_months" | "custom";

/** What a projection covers. */
export type ProjectionTarget =
  | "body_weight_kg"
  | "body_fat_percent"
  | "muscle_mass_kg"
  | "measurement_cm"
  | "strength_1rm_kg"
  | "volume_weekly_sets"
  | "protein_daily_g"
  | "calories_daily_kcal";

/** How the projection metric was derived. */
export type ProjectionMethod =
  | "linear_trend_extrapolation"
  | "exponential_smoothing"
  | "goal_paced"
  | "maintenance"
  | "custom";

/** Assumption category for a projection. */
export type AssumptionCategory =
  | "adherence"
  | "nutrition"
  | "training"
  | "recovery"
  | "progression_rate"
  | "body_composition"
  | "measurement_consistency"
  | "external_factor";

/** A single assumption underlying a projection. */
export interface ProjectionAssumption {
  /** Stable machine code, e.g. "training_adherence_90_percent". */
  code: string;
  /** Human-readable description. */
  description: string;
  /** Category for grouping in UI. */
  category: AssumptionCategory;
  /** The assumed value (serialized). */
  value: string;
  /** Whether changing this assumption would significantly change the projection. */
  sensitive: boolean;
}

/** A single projected metric with range and confidence. */
export interface ProjectionMetric {
  /** What this metric projects. */
  target: ProjectionTarget;
  /** Horizon this metric covers. */
  horizon: ProjectionHorizon;
  /** Central (most likely) estimate. */
  central: Estimated<number>;
  /** Low bound of the projected range. */
  low: Estimated<number>;
  /** High bound of the projected range. */
  high: Estimated<number>;
  /** Projection method used. */
  method: ProjectionMethod;
  /** Qualitative confidence in this metric. */
  confidence: ConfidenceLevel;
  /** Short explanation of how this was derived. */
  basis: string;
}

/** Input snapshot for projection reproducibility. */
export interface ProjectionInputs {
  /** User ID this projection is for. */
  userId: UserId;
  /** Analysis date (anchors all windows). */
  asOf: CalendarDate;
  /** Training data window used. */
  trainingWindowDays: number;
  /** Nutrition data window used. */
  nutritionWindowDays: number;
  /** Body measurement window used. */
  bodyWindowDays: number;
  /** Activity data window used. */
  activityWindowDays: number;
  /** Key derived facts at projection time (serialized). */
  derivedFacts: Record<string, string>;
  /** Active goals at projection time (serialized). */
  activeGoals: Record<string, string>;
  /** Active interventions at projection time (serialized). */
  activeInterventions: Record<string, string>;
}

/** Status of a projection snapshot. */
export type ProjectionStatus = "current" | "superseded" | "diverged";

/**
 * An immutable projection snapshot. Recalculating produces a new snapshot
 * rather than mutating the old one. This ensures the full history of
 * projections is preserved for divergence analysis (Phase 8).
 */
export interface ProjectionSnapshot extends BaseEntity {
  userId: UserId;
  /** The day this projection was generated. */
  generatedAt: CalendarDate;
  /** Projection status for lifecycle. */
  status: ProjectionStatus;
  /** Inputs digest for reproducibility and staleness detection. */
  inputs: ProjectionInputs;
  /** Assumptions underlying this projection. */
  assumptions: readonly ProjectionAssumption[];
  /** Projected metrics with ranges and confidence. */
  metrics: readonly ProjectionMetric[];
  /** Optional: which snapshot this supersedes. */
  supersedesId?: string;
  /** Configuration version used (e.g., "fitcoach.projection.v1"). */
  configVersion: string;
  /** Human-readable summary for UI. */
  summary: string;
  /** Warnings about reliability (e.g., "low measurement frequency"). */
  warnings: readonly string[];
}

/**
 * Records when actual outcomes diverge from a projection.
 * Used as input to diagnosis (Phase 8).
 */
export interface ProjectionDivergence extends BaseEntity {
  /** The projection that was diverged from. */
  projectionSnapshotId: string;
  /** The metric that diverged. */
  target: ProjectionTarget;
  /** Horizon that was projected. */
  horizon: ProjectionHorizon;
  /** Date the divergence was detected. */
  detectedAt: CalendarDate;
  /** Projected central value at that horizon. */
  projectedCentral: number;
  /** Actual observed value at that horizon. */
  actualValue: number;
  /** Absolute difference. */
  absoluteDifference: number;
  /** Relative difference as percentage. */
  relativeDifferencePercent: number;
  /** Whether this divergence is significant enough to trigger diagnosis. */
  significant: boolean;
  /** Context for why this might have happened. */
  context?: string;
}

/** Request to generate a new projection. */
export interface ProjectionRequest {
  userId: UserId;
  /** The day to anchor the projection. Defaults to today. */
  asOf?: CalendarDate;
  /** Specific horizons to project. Defaults to all standard horizons. */
  horizons?: ProjectionHorizon[];
  /** Specific targets to project. Defaults to all available targets. */
  targets?: ProjectionTarget[];
  /** Override specific assumptions. */
  assumptionOverrides?: Partial<Record<AssumptionCategory, string>>;
}

/** Result of generating a projection. */
export interface ProjectionResult {
  /** The generated snapshot. */
  snapshot: ProjectionSnapshot;
  /** Whether this is a new snapshot or an existing current one. */
  isNew: boolean;
  /** Previous current snapshot if superseded. */
  previousSnapshot?: ProjectionSnapshot;
}