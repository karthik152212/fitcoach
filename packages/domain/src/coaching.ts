import type {
  BaseEntity,
  CalendarDate,
  DiagnosisId,
  InterventionId,
  Timestamp,
  UserId,
} from "./shared";

export type Severity = "informational" | "watch" | "act" | "urgent";

/**
 * A deterministic observation backing a diagnosis. Produced by
 * fitness-core/nutrition — never by the AI layer.
 */
export interface Evidence {
  /** Metric identifier, e.g. "protein_daily_avg_g", "waist_trend_cm_per_week". */
  metric: string;
  /** Analysis window, e.g. "last_14_days". */
  window: string;
  /** Observed value(s) in compact serializable form. */
  observed: string;
  /** What was expected given the goal and context, when applicable. */
  expected?: string;
}

export type DiagnosisStatus = "open" | "monitoring" | "resolved" | "dismissed";

/**
 * A diagnosed problem, grounded in evidence. Diagnoses solve problems rather
 * than celebrate numbers; they must name what is wrong (or explicitly state
 * that nothing needs changing).
 */
export interface Diagnosis extends BaseEntity {
  userId: UserId;
  /** Stable machine code, e.g. "protein_intake_below_target". */
  code: string;
  title: string;
  summary: string;
  severity: Severity;
  evidence: readonly Evidence[];
  contributingFactors?: readonly string[];
  ruledOut?: readonly string[];
  status: DiagnosisStatus;
}

/**
 * The kind of lever being pulled. Deliberately excludes punitive concepts:
 * there is no "burn off food" intervention (PRODUCT_SPEC principle 3).
 */
export type InterventionKind =
  | "nutrition_target_adjustment"
  | "food_choice_guidance"
  | "activity_target_adjustment"
  | "training_volume_adjustment"
  | "exercise_substitution"
  | "split_structure_adjustment"
  | "progression_scheme_adjustment"
  | "measurement_protocol_adjustment"
  | "recovery_adjustment"
  | "no_change"
  | "custom";

export type InterventionStatus =
  | "proposed"
  | "accepted"
  | "active"
  | "completed"
  | "rejected"
  | "superseded";

/** Intervention-kind specific parameters; interpreted deterministically. */
export interface InterventionParameters {
  readonly [key: string]: number | string | boolean | null;
}

/**
 * A concrete change applied (or proposed) to solve a diagnosis.
 * "no_change" is a first-class intervention: if the plan works, the correct
 * action may be to leave it alone and say so.
 */
export interface Intervention extends BaseEntity {
  userId: UserId;
  diagnosisId?: DiagnosisId;
  kind: InterventionKind;
  parameters: InterventionParameters;
  /** Why this intervention was selected; required for explainability. */
  rationale: string;
  expectedEffect: string;
  reviewOn?: CalendarDate;
  status: InterventionStatus;
}

export type OutcomeVerdict =
  | "improved_as_expected"
  | "no_effect"
  | "worsened"
  | "uncertain"
  | "too_early";

/**
 * Result of re-evaluating an intervention against real-world data after its
 * review window. This feedback loop is what makes coaching adaptive.
 */
export interface InterventionOutcome extends BaseEntity {
  interventionId: InterventionId;
  evaluatedAt: Timestamp;
  evaluationWindow: string;
  verdict: OutcomeVerdict;
  observations: readonly string[];
  explanation: string;
  followUpDiagnosisId?: DiagnosisId;
}

export type RecommendationStatus =
  | "presented"
  | "acknowledged"
  | "acted_on"
  | "dismissed"
  | "expired";

/**
 * A user-facing communication of a validated recommendation. Every material
 * recommendation must carry an explanation traceable to deterministic
 * findings (PRODUCT_SPEC principle 9).
 */
export interface Recommendation extends BaseEntity {
  userId: UserId;
  diagnosisId?: DiagnosisId;
  interventionId?: InterventionId;
  headline: string;
  explanation: string;
  /** Deterministic findings this recommendation is grounded in. */
  evidenceRefs: readonly Evidence[];
  alternativesConsidered?: readonly string[];
  presentedAt: Timestamp;
  status: RecommendationStatus;
}
