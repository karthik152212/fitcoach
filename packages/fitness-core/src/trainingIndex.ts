/**
 * Phase 3 — Adaptive Training Engine
 *
 * Deterministic training planning, volume, frequency, progression, adaptation,
 * and plan comparison. Consumes Phase 2 exercise intelligence.
 *
 * This module is the curated public surface of the training engine: the
 * package root (`index.ts`) additionally re-exports every engine module.
 */

// Configuration
export {
  getTrainingConfiguration,
  getMuscleVolumeTarget,
  getMuscleVolumeTargetConfig,
  getMuscleFrequencyTargetConfig,
  TRAINING_CONFIG_VERSION,
  DEFAULT_MUSCLE_VOLUME_TARGETS,
  DEFAULT_MUSCLE_FREQUENCY_TARGETS,
  DEFAULT_SESSION_DURATION_BUDGET,
  DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
  DEFAULT_PROGRESSION_CONFIGURATION,
  DEFAULT_ADAPTATION_THRESHOLDS,
  DEFAULT_SPLIT_CONFIGURATION,
  PLAN_QUALITY_WEIGHTS,
  GOAL_TRAINING_MODIFIERS,
  GOAL_VOLUME_MODIFIER,
  EXPERIENCE_VOLUME_MODIFIER,
  REST_SECONDS_BY_GOAL,
  WARMUP_MINUTES_BY_SESSION_TYPE,
  type MuscleVolumeTargetConfig,
  type MuscleFrequencyTargetConfig,
} from "./trainingConfig";

// Volume
export {
  calculateEffectiveSetContribution,
  roleCoefficient,
  calculateMuscleVolume,
  generateWeeklyVolumeReport,
  assessVolumeAppropriateness,
  recommendVolumeAdjustments,
  computeTrainingVolume,
  type EffectiveSetContribution,
  type MuscleVolumeContribution,
  type WeeklyVolumeReport,
  type VolumeAdjustment,
} from "./volume";

// Progression
export {
  buildProgressionRule,
  evaluateProgression,
  computeProgressionStatus,
  evaluateDeloadNeed,
} from "./progression";

// Split generation
export {
  selectSplit,
  generateSplit,
  type SplitType,
  type GeneratedSplit,
  type SplitSession,
} from "./splitGeneration";

// Goal alignment
export {
  getGoalMusclePriorities,
  getGoalValuedRoles,
  evaluateGoalAlignment,
  goalAlignmentQuality,
  describeGoalStrategy,
  type GoalAlignmentResult,
} from "./goalAlignment";

// Frequency
export {
  getMuscleFrequencyTarget,
  distributeFrequency,
  assessFrequency,
  type SessionFrequency,
  type SessionAssignment,
} from "./frequency";

// Session construction
export {
  estimateSessionDuration,
  repairOverBudgetSession,
  buildSessionFromAssignments,
  type DurationBreakdownItem,
  type SessionRepairChange,
} from "./sessionConstruction";

// Adaptation
export {
  detectPlateauSignals,
  makeAdaptationDecision,
} from "./adaptation";

// Plan comparison
export {
  comparePlans,
  summarizePlanComparison,
} from "./planComparison";

// Trend detection
export {
  detectTrend,
  detectTrends,
  computeExerciseTrend,
  type TrendPoint,
  type TrendDirection,
  type TrendAnalysis,
  type TrendOptions,
  type TrendInput,
  type ExerciseTrend,
} from "./trendDetection";

// Domain contracts re-exported for consumers of the training engine
export type {
  AdaptationDecision,
  AdaptationOutcome,
  AdaptationThresholds,
  EffectiveSetCoefficients,
  ExercisePerformance,
  MuscleFrequencyTarget,
  MuscleVolumeTarget,
  PlanChange,
  PlanChangeKind,
  PlanComparison,
  PlanDecision,
  PlanSummary,
  PlateauSignal,
  PlateauSignalKind,
  ProgressionAction,
  ProgressionConfiguration,
  ProgressionRule,
  ProgressionStatus,
  SessionDurationBudget,
  SplitConfiguration,
  TrainingConfiguration,
  TrainingContext,
  TrainingState,
} from "@fitcoach/domain";
