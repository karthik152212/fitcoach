import type { BodySite } from "@fitcoach/domain";
import type { PhysiquePriorityTag } from "./types";

/**
 * Body engine configuration — versioned, with basisNote for explainability.
 * Mirrors the pattern in activity.ts and recovery.ts.
 */

// -----------------------------------------------------------------------------
// Measurement analysis configuration
// -----------------------------------------------------------------------------

export interface MeasurementAnalysisConfig {
  version: number;
  /** Minimum weight readings in 28 days for trend detection. */
  minWeightReadingsForTrend: number;
  /** Minimum circumference readings per site for trend detection. */
  minCircumferenceReadingsPerSite: number;
  /** Minimum unique circumference sites for composition estimation. */
  minSitesForComposition: number;
  /** Preferred sites for composition (in order). */
  preferredCompositionSites: readonly BodySite[];
  /** Stability threshold for detectTrend (relative change per day). */
  trendStabilityThresholdPerDay: number;
  /** Maximum gap between measurements (days) before warning. */
  maxMeasurementGapDays: number;
  /** Data quality weights. */
  qualityWeights: {
    weightFrequency: number;
    circumferenceCoverage: number;
    consistency: number;
    recency: number;
  };
  basisNote: string;
}

export const DEFAULT_MEASUREMENT_ANALYSIS_CONFIG: MeasurementAnalysisConfig = {
  version: 1,
  minWeightReadingsForTrend: 7,
  minCircumferenceReadingsPerSite: 3,
  minSitesForComposition: 2,
  preferredCompositionSites: ["waist", "neck", "hips", "chest", "left_thigh", "right_thigh"],
  trendStabilityThresholdPerDay: 0.001, // 0.1% per day
  maxMeasurementGapDays: 14,
  qualityWeights: {
    weightFrequency: 0.4,
    circumferenceCoverage: 0.3,
    consistency: 0.2,
    recency: 0.1,
  },
  basisNote: "Measurement analysis config v1: min 7 weight readings, 3 per circumference site, 2+ sites for composition. Stability threshold 0.1%/day. Quality weights: weight freq 40%, site coverage 30%, consistency 20%, recency 10%.",
};

// -----------------------------------------------------------------------------
// Body composition estimation configuration
// -----------------------------------------------------------------------------

export interface BodyCompositionConfig {
  version: number;
  /** Navy method constants (male). */
  navyMale: { waistCoeff: number; neckCoeff: number; heightCoeff: number; constant: number };
  /** Navy method constants (female). */
  navyFemale: { waistCoeff: number; hipCoeff: number; neckCoeff: number; heightCoeff: number; constant: number };
  /** Multi-site method coefficients (simplified Jackson-Pollock style). */
  multiSite: {
    male: Readonly<Record<BodySite, number>>;
    female: Readonly<Record<BodySite, number>>;
    constantMale: number;
    constantFemale: number;
  };
  /** Uncertainty by method. */
  methodUncertainty: {
    weight_waist_neck: number;
    weight_waist_hip: number;
    multi_site: number;
    weight_only: number;
  };
  /** Minimum confidence to return an estimate. */
  minConfidenceToReturn: number;
  basisNote: string;
}

export const DEFAULT_BODY_COMPOSITION_CONFIG: BodyCompositionConfig = {
  version: 1,
  navyMale: { waistCoeff: 1.0324, neckCoeff: -0.5411, heightCoeff: -70.331, constant: 495 },
  navyFemale: { waistCoeff: 1.29579, hipCoeff: 0.35004, neckCoeff: -0.221, heightCoeff: -61.538, constant: 495 },
  multiSite: {
    male: {
      neck: 0.235,
      chest: 0.153,
      waist: 0.312,
      hips: 0.124,
      left_upper_arm: 0.087,
      right_upper_arm: 0.087,
      left_thigh: 0.102,
      right_thigh: 0.102,
      left_calf: 0.058,
      right_calf: 0.058,
      shoulders: 0.091,
    },
    female: {
      neck: 0.182,
      chest: 0.118,
      waist: 0.287,
      hips: 0.212,
      left_upper_arm: 0.094,
      right_upper_arm: 0.094,
      left_thigh: 0.134,
      right_thigh: 0.134,
      left_calf: 0.067,
      right_calf: 0.067,
      shoulders: 0.078,
    },
    constantMale: 495,
    constantFemale: 495,
  },
  methodUncertainty: {
    weight_waist_neck: 4.0,
    weight_waist_hip: 3.5,
    multi_site: 2.5,
    weight_only: 6.0,
  },
  minConfidenceToReturn: 0.3,
  basisNote: "Body composition config v1: Navy method (waist/neck/height) ±4%, Navy+hip ±3.5%, multi-site (7+ sites) ±2.5%, weight-only ±6%. Min confidence 0.3 to return estimate. Male/female coefficients from validated anthropometric equations.",
};

// -----------------------------------------------------------------------------
// Physique goal configuration
// -----------------------------------------------------------------------------

export interface PhysiqueGoalConfig {
  version: number;
  /** Default priority tags if user hasn't set any. */
  defaultPriorities: readonly PhysiquePriorityTag[];
  /** Mapping from priority tag to relevant muscle groups for analysis. */
  priorityToMuscles: Readonly<Record<PhysiquePriorityTag, readonly string[]>>;
  /** Symmetry comparison pairs (left vs right). */
  symmetryPairs: readonly [string, string][];
  /** Proportion ratios to monitor (e.g., shoulder:waist). */
  proportionRatios: readonly { name: string; numerator: string[]; denominator: string[]; targetRange: [number, number] }[];
  /** Minimum observation window for disproportionate assessment (weeks). */
  minObservationWeeks: number;
  /** Severity thresholds for disproportionate flags. */
  severityThresholds: { mild: number; moderate: number; severe: number };
  basisNote: string;
}

export const DEFAULT_PHYSIQUE_GOAL_CONFIG: PhysiqueGoalConfig = {
  version: 1,
  defaultPriorities: ["symmetry", "proportion", "overall_mass"],
  priorityToMuscles: {
    upper_body: ["chest", "back", "shoulders", "biceps", "triceps"],
    lower_body: ["quadriceps", "hamstrings", "glutes", "calves"],
    push_muscles: ["chest", "shoulders", "triceps"],
    pull_muscles: ["back", "biceps", "rear_delts"],
    legs: ["quadriceps", "hamstrings", "glutes", "calves"],
    glutes: ["glutes"],
    core: ["abs", "obliques", "lower_back"],
    shoulder_width: ["shoulders", "lateral_delts"],
    waist_proportion: ["abs", "obliques", "waist"],
    arm_size: ["biceps", "triceps", "forearms"],
    leg_size: ["quadriceps", "hamstrings", "glutes", "calves"],
    back_width: ["lats", "rear_delts", "traps"],
    chest_development: ["chest"],
    symmetry: ["biceps", "triceps", "forearms", "quadriceps", "hamstrings", "calves", "shoulders"],
    proportion: ["shoulders", "waist", "chest", "hips", "quadriceps", "calves"],
    overall_mass: ["chest", "back", "shoulders", "quadriceps", "hamstrings", "glutes", "biceps", "triceps"],
    leanness: ["abs", "obliques", "waist"],
    custom: [],
  },
  symmetryPairs: [
    ["left_upper_arm", "right_upper_arm"],
    ["left_thigh", "right_thigh"],
    ["left_calf", "right_calf"],
    ["left_deltoid", "right_deltoid"], // if tracked
  ],
  proportionRatios: [
    { name: "shoulder_to_waist", numerator: ["shoulders"], denominator: ["waist"], targetRange: [1.4, 1.6] },
    { name: "chest_to_waist", numerator: ["chest"], denominator: ["waist"], targetRange: [1.1, 1.3] },
    { name: "arm_to_waist", numerator: ["left_upper_arm", "right_upper_arm"], denominator: ["waist"], targetRange: [0.35, 0.45] },
    { name: "thigh_to_waist", numerator: ["left_thigh", "right_thigh"], denominator: ["waist"], targetRange: [0.55, 0.7] },
    { name: "calf_to_arm", numerator: ["left_calf", "right_calf"], denominator: ["left_upper_arm", "right_upper_arm"], targetRange: [0.9, 1.1] },
  ],
  minObservationWeeks: 8,
  severityThresholds: { mild: 0.3, moderate: 0.5, severe: 0.7 },
  basisNote: "Physique goal config v1: default priorities symmetry/proportion/mass. 13 priority→muscle mappings. 5 symmetry pairs. 5 proportion ratios with target ranges. Min 8 weeks observation. Severity thresholds: mild 0.3, moderate 0.5, severe 0.7.",
};

// -----------------------------------------------------------------------------
// Muscle development analysis configuration
// -----------------------------------------------------------------------------

export interface MuscleDevelopmentConfig {
  version: number;
  /** Weight for training exposure in overall development score. */
  trainingExposureWeight: number;
  /** Weight for measurement trend in overall development score. */
  measurementTrendWeight: number;
  /** Weight for recovery context in overall development score. */
  recoveryContextWeight: number;
  /** Weight for volume appropriateness in overall development score. */
  volumeAppropriatenessWeight: number;
  /** Training exposure thresholds. */
  trainingExposureThresholds: { low: number; moderate: number; high: number };
  /** Recovery context mapping. */
  recoveryContextScores: { supportive: number; neutral: number; limiting: number };
  /** Volume appropriateness thresholds (vs goal target). */
  volumeTargets: { insufficientRatio: number; excessiveRatio: number };
  /** Minimum confidence to make development assessment. */
  minConfidenceForAssessment: number;
  basisNote: string;
}

export const DEFAULT_MUSCLE_DEVELOPMENT_CONFIG: MuscleDevelopmentConfig = {
  version: 1,
  trainingExposureWeight: 0.4,
  measurementTrendWeight: 0.3,
  recoveryContextWeight: 0.15,
  volumeAppropriatenessWeight: 0.15,
  trainingExposureThresholds: { low: 30, moderate: 60, high: 80 },
  recoveryContextScores: { supportive: 1.0, neutral: 0.7, limiting: 0.4 },
  volumeTargets: { insufficientRatio: 0.7, excessiveRatio: 1.3 },
  minConfidenceForAssessment: 0.4,
  basisNote: "Muscle development config v1: weights — training exposure 40%, measurement trend 30%, recovery 15%, volume 15%. Exposure thresholds: low<30, mod<60, high≥80. Recovery scores: supportive 1.0, neutral 0.7, limiting 0.4. Volume ratios: insufficient<0.7x, excessive>1.3x target. Min confidence 0.4.",
};

// -----------------------------------------------------------------------------
// Disproportionate development assessment rules configuration
// -----------------------------------------------------------------------------

export interface DisproportionateRuleConfig {
  version: number;
  rules: readonly DisproportionateRule[];
  basisNote: string;
}

export interface DisproportionateRule {
  id: string;
  version: number;
  /** Priority tag this rule relates to. */
  priorityTag: PhysiquePriorityTag;
  /** Type of check. */
  type: "lagging" | "dominant" | "asymmetric" | "proportion_deviation";
  /** Muscles/groups to evaluate. */
  muscles: readonly string[];
  /** Condition function name (implemented in assessment.ts). */
  condition: string;
  /** Parameters for the condition. */
  params: Readonly<Record<string, number | string>>;
  /** Minimum observation window (weeks). */
  minObservationWeeks: number;
  /** Severity if triggered. */
  severity: number;
  /** Confidence in rule. */
  confidence: number;
  /** Recommended intervention category. */
  recommendedIntervention: "collect_more_data" | "adjust_nutrition" | "review_training" | "reassess_technique" | "maintain" | "no_change";
  /** Human-readable description. */
  description: string;
}

export const DEFAULT_DISPROPORTIONATE_RULES_CONFIG: DisproportionateRuleConfig = {
  version: 1,
  rules: [
    {
      id: "symmetry_arms",
      version: 1,
      priorityTag: "symmetry",
      type: "asymmetric",
      muscles: ["left_upper_arm", "right_upper_arm"],
      condition: "asymmetry_ratio",
      params: { thresholdRatio: 1.1, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.5,
      confidence: 0.8,
      recommendedIntervention: "reassess_technique",
      description: "Left/right arm circumference difference >10% over 8+ weeks suggests technique or structural asymmetry.",
    },
    {
      id: "symmetry_thighs",
      version: 1,
      priorityTag: "symmetry",
      type: "asymmetric",
      muscles: ["left_thigh", "right_thigh"],
      condition: "asymmetry_ratio",
      params: { thresholdRatio: 1.1, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.5,
      confidence: 0.8,
      recommendedIntervention: "reassess_technique",
      description: "Left/right thigh circumference difference >10% over 8+ weeks suggests technique or structural asymmetry.",
    },
    {
      id: "symmetry_calves",
      version: 1,
      priorityTag: "symmetry",
      type: "asymmetric",
      muscles: ["left_calf", "right_calf"],
      condition: "asymmetry_ratio",
      params: { thresholdRatio: 1.1, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.4,
      confidence: 0.7,
      recommendedIntervention: "collect_more_data",
      description: "Left/right calf circumference difference >10% over 8+ weeks — often structural, monitor.",
    },
    {
      id: "shoulder_width_lagging",
      version: 1,
      priorityTag: "shoulder_width",
      type: "lagging",
      muscles: ["side_delts", "front_delts", "rear_delts"],
      condition: "training_exposure_vs_priority",
      params: { exposureThreshold: 40, minWeeks: 6 },
      minObservationWeeks: 6,
      severity: 0.6,
      confidence: 0.75,
      recommendedIntervention: "review_training",
      description: "Shoulder width is a priority but training exposure score <40 over 6+ weeks — review lateral delt volume.",
    },
    {
      id: "waist_proportion_expanding",
      version: 1,
      priorityTag: "waist_proportion",
      type: "proportion_deviation",
      muscles: ["waist", "shoulders"],
      condition: "proportion_ratio_deviation",
      params: { ratioName: "shoulder_to_waist", deviationThreshold: 0.15, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.7,
      confidence: 0.8,
      recommendedIntervention: "adjust_nutrition",
      description: "Shoulder-to-waist ratio deviating >15% from target range over 8+ weeks — nutrition adjustment indicated.",
    },
    {
      id: "chest_development_lagging",
      version: 1,
      priorityTag: "chest_development",
      type: "lagging",
      muscles: ["chest"],
      condition: "training_exposure_vs_priority",
      params: { exposureThreshold: 40, minWeeks: 6 },
      minObservationWeeks: 6,
      severity: 0.6,
      confidence: 0.75,
      recommendedIntervention: "review_training",
      description: "Chest development is a priority but training exposure <40 over 6+ weeks — review pressing volume/frequency.",
    },
    {
      id: "back_width_lagging",
      version: 1,
      priorityTag: "back_width",
      type: "lagging",
      muscles: ["upper_back", "lats", "rear_delts", "traps"],
      condition: "training_exposure_vs_priority",
      params: { exposureThreshold: 40, minWeeks: 6 },
      minObservationWeeks: 6,
      severity: 0.6,
      confidence: 0.75,
      recommendedIntervention: "review_training",
      description: "Back width is a priority but training exposure <40 over 6+ weeks — review vertical/horizontal pull volume.",
    },
    {
      id: "leg_size_lagging",
      version: 1,
      priorityTag: "leg_size",
      type: "lagging",
      muscles: ["quadriceps", "hamstrings", "glutes"],
      condition: "training_exposure_vs_priority",
      params: { exposureThreshold: 40, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.6,
      confidence: 0.75,
      recommendedIntervention: "review_training",
      description: "Leg size is a priority but lower body training exposure <40 over 8+ weeks — review squat/hinge frequency.",
    },
    {
      id: "arm_size_lagging",
      version: 1,
      priorityTag: "arm_size",
      type: "lagging",
      muscles: ["biceps", "triceps"],
      condition: "training_exposure_vs_priority",
      params: { exposureThreshold: 40, minWeeks: 6 },
      minObservationWeeks: 6,
      severity: 0.5,
      confidence: 0.7,
      recommendedIntervention: "review_training",
      description: "Arm size is a priority but arm training exposure <40 over 6+ weeks — review direct arm volume.",
    },
    {
      id: "overall_mass_stagnation",
      version: 1,
      priorityTag: "overall_mass",
      type: "lagging",
      muscles: ["chest", "back", "shoulders", "quadriceps", "hamstrings", "glutes", "biceps", "triceps"],
      condition: "weight_trend_stagnation",
      params: { minWeightGainKgPerMonth: 0.5, minWeeks: 12 },
      minObservationWeeks: 12,
      severity: 0.6,
      confidence: 0.7,
      recommendedIntervention: "adjust_nutrition",
      description: "Overall mass is a priority but weight trend <0.5kg/month over 12+ weeks — caloric surplus needed.",
    },
    {
      id: "leanness_stagnation",
      version: 1,
      priorityTag: "leanness",
      type: "lagging",
      muscles: ["waist", "abs", "obliques"],
      condition: "waist_trend_stagnation",
      params: { maxWaistChangeCmPerMonth: 0.5, minWeeks: 8 },
      minObservationWeeks: 8,
      severity: 0.6,
      confidence: 0.7,
      recommendedIntervention: "adjust_nutrition",
      description: "Leanness is a priority but waist not decreasing >0.5cm/month over 8+ weeks — caloric deficit needed.",
    },
    {
      id: "proportion_deviation_general",
      version: 1,
      priorityTag: "proportion",
      type: "proportion_deviation",
      muscles: ["shoulders", "waist", "chest", "hips", "left_thigh", "right_thigh", "left_calf", "right_calf", "left_upper_arm", "right_upper_arm"],
      condition: "proportion_ratio_deviation",
      params: { deviationThreshold: 0.2, minWeeks: 12 },
      minObservationWeeks: 12,
      severity: 0.4,
      confidence: 0.6,
      recommendedIntervention: "collect_more_data",
      description: "General proportion ratios deviating >20% from targets over 12+ weeks — collect more data before intervening.",
    },
  ],
  basisNote: "Disproportionate rules config v1: 12 rules covering symmetry (3), priority-specific lagging (6), proportion deviations (2), mass/leanness stagnation (2). All versioned. Conditions: asymmetry_ratio, training_exposure_vs_priority, proportion_ratio_deviation, weight_trend_stagnation, waist_trend_stagnation. Min observation 6-12 weeks. Interventions: collect_more_data, adjust_nutrition, review_training, reassess_technique, maintain.",
};

// -----------------------------------------------------------------------------
// Recommendations configuration
// -----------------------------------------------------------------------------

export interface RecommendationsConfig {
  version: number;
  /** Reassessment windows by intervention category (weeks). */
  reassessWindows: Readonly<Record<string, number>>;
  /** Priority ordering for recommendation categories. */
  categoryPriority: readonly string[];
  /** Maximum concurrent recommendations. */
  maxConcurrentRecommendations: number;
  /** Confidence threshold to emit recommendation. */
  minConfidenceToRecommend: number;
  basisNote: string;
}

export const DEFAULT_RECOMMENDATIONS_CONFIG: RecommendationsConfig = {
  version: 1,
  reassessWindows: {
    maintain: 4,
    collect_more_data: 4,
    adjust_nutrition: 2,
    review_training: 3,
    reassess_technique: 4,
    no_change: 8,
  },
  categoryPriority: ["adjust_nutrition", "review_training", "reassess_technique", "collect_more_data", "maintain", "no_change"],
  maxConcurrentRecommendations: 3,
  minConfidenceToRecommend: 0.5,
  basisNote: "Recommendations config v1: reassess windows — nutrition 2w, training 3w, technique 4w, data 4w, maintain 4w, no_change 8w. Priority: nutrition > training > technique > data > maintain > no_change. Max 3 concurrent. Min confidence 0.5.",
};

// -----------------------------------------------------------------------------
// Aggregated configuration export
// -----------------------------------------------------------------------------

export interface BodyEngineConfig {
  measurementAnalysis: MeasurementAnalysisConfig;
  bodyComposition: BodyCompositionConfig;
  physiqueGoal: PhysiqueGoalConfig;
  muscleDevelopment: MuscleDevelopmentConfig;
  disproportionateRules: DisproportionateRuleConfig;
  recommendations: RecommendationsConfig;
}

export const DEFAULT_BODY_ENGINE_CONFIG: BodyEngineConfig = {
  measurementAnalysis: DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
  bodyComposition: DEFAULT_BODY_COMPOSITION_CONFIG,
  physiqueGoal: DEFAULT_PHYSIQUE_GOAL_CONFIG,
  muscleDevelopment: DEFAULT_MUSCLE_DEVELOPMENT_CONFIG,
  disproportionateRules: DEFAULT_DISPROPORTIONATE_RULES_CONFIG,
  recommendations: DEFAULT_RECOMMENDATIONS_CONFIG,
};