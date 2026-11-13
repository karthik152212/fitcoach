import type { CalendarDate, Timestamp, BaseEntity, UserId, MuscleGroup } from "@fitcoach/domain";

/**
 * Physique goal kinds and priority tags.
 * Users express what matters to them — the engine reasons from these.
 */
export type PhysiquePriorityTag =
  | "upper_body"
  | "lower_body"
  | "push_muscles"
  | "pull_muscles"
  | "legs"
  | "glutes"
  | "core"
  | "shoulder_width"
  | "waist_proportion"
  | "arm_size"
  | "leg_size"
  | "back_width"
  | "chest_development"
  | "symmetry"
  | "proportion"
  | "overall_mass"
  | "leanness"
  | "custom";

export interface PhysiqueGoal extends BaseEntity {
  userId: UserId;
  /** Ordered priorities — first is highest priority. */
  priorities: readonly PhysiquePriorityTag[];
  /** Custom priority labels (when tag is "custom"). */
  customPriorities?: readonly { tag: string; label: string }[];
  /** Target timeframe for notable progress (weeks). */
  targetTimeframeWeeks?: number;
  /** Whether the user wants to maintain, gain, or lose in priority areas. */
  direction?: "maintain" | "gain" | "lose" | "recomp";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Body composition estimate with uncertainty.
 * Only computed when data supports it (weight trend + ≥2 circumferences + history).
 */
export interface BodyCompositionEstimate {
  /** Estimated body fat percentage. */
  bodyFatPercent: number;
  /** Uncertainty bounds (±percentage points). */
  uncertaintyPct: number;
  /** Method used for estimation. */
  method: "weight_waist_neck" | "weight_waist_hip" | "multi_site" | "weight_only";
  /** Confidence in the estimate (0-1). */
  confidence: number;
  /** Calendar date of the estimate. */
  asOf: CalendarDate;
  /** Inputs that contributed to this estimate. */
  inputs: {
    weightKg: number;
    circumferencesUsed: string[];
    measurementCount: number;
  };
  /** Human-readable explanation. */
  basisNote: string;
}

/**
 * Weight trend analysis result.
 */
export interface WeightTrendAnalysis {
  direction: "increasing" | "decreasing" | "stable" | "insufficient_data";
  slopeKgPerWeek: number | null;
  confidence: number | null;
  pointsUsed: number;
  warnings: readonly string[];
  /** Latest weight. */
  currentWeightKg: number | null;
  /** 7-day average weight. */
  averageWeight7dKg: number | null;
  /** 14-day average weight. */
  averageWeight14dKg: number | null;
}

/**
 * Circumference trend analysis result.
 */
export interface CircumferenceTrendAnalysis {
  site: string;
  direction: "increasing" | "decreasing" | "stable" | "insufficient_data";
  slopeCmPerWeek: number | null;
  confidence: number | null;
  pointsUsed: number;
  warnings: readonly string[];
  latestCm: number | null;
}

/**
 * Measurement completeness assessment.
 */
export interface MeasurementCompleteness {
  /** Weight readings in last 28 days. */
  weightReadings: number;
  /** Unique circumference sites measured in last 28 days. */
  circumferenceSites: string[];
  /** Total circumference readings in last 28 days. */
  circumferenceReadings: number;
  /** Whether body composition can be estimated. */
  canEstimateComposition: boolean;
  /** Missing sites for composition estimation. */
  missingForComposition: string[];
  /** Overall data quality score (0-1). */
  dataQualityScore: number;
}

/**
 * Muscle development assessment for a single muscle/group.
 */
export interface MuscleDevelopment {
  muscle: MuscleGroup;
  /** Training exposure score (0-100) from volume, frequency, coverage. */
  trainingExposureScore: number;
  /** Measurement trend direction if measurable (e.g., arm, thigh, calf). */
  measurementTrend?: "increasing" | "decreasing" | "stable" | "insufficient_data";
  /** Measurement trend slope per week (cm). */
  measurementSlopePerWeek?: number | null;
  /** Measurement confidence (0-1). */
  measurementConfidence?: number | null;
  /** Recovery context affecting development. */
  recoveryContext: "supportive" | "neutral" | "limiting";
  /** Volume appropriateness vs goal targets. */
  volumeAppropriateness: "insufficient" | "appropriate" | "excessive" | "unknown";
  /** Overall development assessment. */
  developmentStatus: "progressing" | "maintaining" | "regressing" | "insufficient_data";
  /** Confidence in overall assessment (0-1). */
  confidence: number;
  /** Evidence summary for auditability. */
  evidence: readonly string[];
}

/**
 * Disproportionate development assessment.
 */
export interface DisproportionateDevelopment {
  /** Rule that triggered this assessment. */
  ruleId: string;
  /** Rule version. */
  ruleVersion: number;
  /** Priority tag this relates to. */
  priorityTag: PhysiquePriorityTag;
  /** Muscles/groups involved. */
  involvedMuscles: readonly string[];
  /** Type of disproportion. */
  type: "lagging" | "dominant" | "asymmetric" | "proportion_deviation";
  /** Severity (0-1). */
  severity: number;
  /** Confidence (0-1). */
  confidence: number;
  /** Observation window (weeks). */
  observationWeeks: number;
  /** Human-readable observation. */
  observation: string;
  /** Evidence citations. */
  evidence: readonly string[];
  /** Recommended intervention category. */
  recommendedIntervention: "collect_more_data" | "adjust_nutrition" | "review_training" | "reassess_technique" | "maintain" | "no_change";
  /** Basis note for explainability. */
  basisNote: string;
}

/**
 * Complete body assessment output.
 */
export interface BodyAssessment {
  userId: UserId;
  asOf: CalendarDate;
  weightTrend: WeightTrendAnalysis;
  circumferenceTrends: readonly CircumferenceTrendAnalysis[];
  composition?: BodyCompositionEstimate;
  completeness: MeasurementCompleteness;
  muscleDevelopment: readonly MuscleDevelopment[];
  disproportionateDevelopment: readonly DisproportionateDevelopment[];
  /** Overall physique progress relative to goals. */
  goalRelativeProgress: "on_track" | "needs_attention" | "insufficient_data";
  /** Priority actions. */
  priorityActions: readonly string[];
}

/**
 * Body recommendation (proportionate intervention).
 */
export interface BodyRecommendation {
  /** Category of intervention. */
  category: "maintain" | "collect_more_data" | "adjust_nutrition" | "review_training" | "reassess_technique" | "no_change";
  /** Priority (1 = highest). */
  priority: number;
  /** Related assessment rule IDs. */
  relatedRules: readonly string[];
  /** Human-readable recommendation. */
  recommendation: string;
  /** Rationale. */
  rationale: string;
  /** Confidence (0-1). */
  confidence: number;
  /** Time window to reassess. */
  reassessInWeeks: number;
}

/**
 * Cross-engine integration input from body engine.
 */
export interface BodyContextForIntegration {
  weightTrendDirection: "increasing" | "decreasing" | "stable" | "insufficient_data";
  weightSlopeKgPerWeek: number | null;
  compositionConfidence: number;
  muscleDevelopmentGaps: readonly string[]; // muscle groups lagging
  disproportionateFlags: readonly string[]; // rule IDs
  goalRelativeProgress: "on_track" | "needs_attention" | "insufficient_data";
}