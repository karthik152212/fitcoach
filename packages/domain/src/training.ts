import type {
  BaseEntity,
  CalendarDate,
  EffortLevel,
  EntityId,
  ExerciseId,
  GoalId,
  MuscleId,
  Timestamp,
  TrainingPlanId,
  UserId,
  WorkoutId,
} from "./shared";
import type { ExercisePreferenceKind } from "./exercise";
import type { TrainingGoalProfile } from "./suitability";
import type { TrainingExperience } from "./user";

// ---------------------------------------------------------------------------
// Training context — what the planner needs to know about the person
// ---------------------------------------------------------------------------

export interface TrainingContext {
  /** User whose plan is being generated. */
  userId: UserId;
  /** IANA timezone; defines user-local day math. */
  timezone: string;
  /** Optional demographic/contextual data where relevant. */
  birthDate?: CalendarDate;
  sex?: string;
  heightCm?: number;
  /** Current body weight in kg. */
  currentBodyWeightKg?: number;
  /** Training experience level. */
  trainingExperience: TrainingExperience;
  /** Training age in months (approximate time consistently training). */
  trainingAgeMonths?: number;
  /** User-stated limitations/injuries as free-form tags. */
  limitations?: readonly string[];
  /** Days the user can train per week (0–7). */
  availableTrainingDays: number;
  /** Preferred training days (0=Sunday..6=Saturday), optional. */
  preferredTrainingDays?: readonly number[];
  /** Maximum session duration in minutes. */
  maxSessionDurationMinutes: number;
  /** Preferred training style if represented; defaults to goal-driven. */
  preferredStyle?: string;
  /** Exercise preferences resolved to the applicable date. */
  exercisePreferences?: Readonly<Record<ExerciseId, ExercisePreferenceKind>>;
  /** Equipment the user currently has available. */
  availableEquipmentIds: readonly string[];
  /** Equipment the user owns but cannot use right now. */
  temporarilyUnavailableEquipmentIds?: readonly string[];
  /** Date the plan is being generated for. */
  asOf: CalendarDate;
}

// ---------------------------------------------------------------------------
// Goal context — the goal and its priorities
// ---------------------------------------------------------------------------

export interface GoalContext {
  /** Active goal id. */
  goalId: GoalId;
  /** Goal kind (maps to TrainingGoalProfile via goalProfileFor). */
  goalKind: string;
  /** Goal start date (user-local). */
  goalStartDate: CalendarDate;
  /** Goal end date if present, else null. */
  goalEndDate?: CalendarDate | null;
  /** Ordered priority tags. */
  priorities: readonly string[];
  /** Physique priorities where applicable (e.g. "shoulder_width", "waist_control"). */
  physiquePriorities?: readonly string[];
  /** Target muscles/regions where applicable. */
  targetMuscleSlugs?: readonly string[];
  /** Goal-specific training emphasis if any. */
  trainingEmphasis?: string;
}

// ---------------------------------------------------------------------------
// Training history — what the user has actually done
// ---------------------------------------------------------------------------

export interface CompletedSet {
  exerciseId: ExerciseId;
  setNumber: number;
  /** "warmup" | "working" | "drop_set" | ... */
  kind: string;
  loadKg?: number;
  reps?: number;
  rir?: number;
  rpe?: number;
  completedAt: Timestamp;
}

export interface CompletedSession {
  workoutId: WorkoutId;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  /** "completed" | "partial" | "skipped" */
  status: string;
  exercises: readonly CompletedExercise[];
  completedAtLocalDate: CalendarDate;
}

export interface CompletedExercise {
  exerciseId: ExerciseId;
  sets: readonly CompletedSet[];
  preferredReps?: number;
  preferredLoadKg?: number;
}

export interface TrainingHistory {
  /** Previous plans (version summaries). */
  previousPlans?: readonly PlanVersionSummary[];
  /** Completed sessions in the recent window. */
  recentSessions?: readonly CompletedSession[];
  /** Exercise performance history for progression. */
  exercisePerformance?: Readonly<Record<ExerciseId, ExercisePerformance>>;
  /** Missed sessions in recent window (dates). */
  missedSessionDates?: readonly CalendarDate[];
  /** Recent training frequency (sessions per week, trailing 4 weeks). */
  recentFrequencyPerWeek?: number;
  /** Recent muscle exposure (per-muscle effective volume, trailing week). */
  recentMuscleExposure?: Readonly<Record<MuscleId, number>>;
  /** Recent effective volume per exercise. */
  recentEffectiveVolume?: Readonly<Record<ExerciseId, number>>;
}

export interface ExercisePerformance {
  /** Best completed set at top of rep range. */
  bestReps?: number;
  /** Best load completed at target reps. */
  bestLoadKg?: number;
  /** Most recent target RIR achieved. */
  recentRir?: number;
  /** Sessions where this exercise was completed. */
  completedSessions: number;
  /** Sessions where this exercise was attempted but not completed. */
  incompleteSessions: number;
  /** Trend: "improving" | "stable" | "declining" | "unknown". */
  trend?: string;
}

export interface PlanVersionSummary {
  planVersionId: EntityId;
  versionNumber: number;
  startsOn: CalendarDate;
  exerciseIds: readonly ExerciseId[];
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Training plan domain model
// ---------------------------------------------------------------------------

export type TrainingPlanStatus = "draft" | "active" | "paused" | "retired";
export type PlanLifecycleStatus = "active" | "superseded" | "retired";

export interface TrainingPlan {
  id: TrainingPlanId;
  userId: UserId;
  name: string;
  status: TrainingPlanStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TrainingPlanVersion {
  id: EntityId;
  planId: TrainingPlanId;
  versionNumber: number;
  startsOn: CalendarDate;
  endsOn?: CalendarDate | null;
  /** Why the plan was created/changed. */
  rationaleNotes?: string;
  /** Generation reason code. */
  generationReason?: string;
  /** Parent version id if this is an adjustment. */
  parentVersionId?: EntityId | null;
  /** Deterministic decision metadata snapshot. */
  decisionSnapshot?: PlanDecisionSnapshot;
  createdAt: Timestamp;
}

export interface PlanDecisionSnapshot {
  decisionId: EntityId;
  generatedAt: Timestamp;
  goalSnapshot: GoalSnapshot;
  equipmentSnapshot: EquipmentSnapshot;
  constraintSnapshot: ConstraintSnapshot;
  historyWindow: HistoryWindow;
  configurationVersion: string;
  modelVersion: string;
}

export interface GoalSnapshot {
  goalId: GoalId;
  goalKind: string;
  priorities: readonly string[];
  physiquePriorities: readonly string[];
  asOf: CalendarDate;
}

export interface EquipmentSnapshot {
  availableEquipmentIds: readonly string[];
  temporarilyUnavailableEquipmentIds: readonly string[];
  asOf: CalendarDate;
}

export interface ConstraintSnapshot {
  availableTrainingDays: number;
  maxSessionDurationMinutes: number;
  limitations: readonly string[];
  asOf: CalendarDate;
}

export interface HistoryWindow {
  /** Trailing days of history considered. */
  windowDays: number;
  asOf: CalendarDate;
}

export interface TrainingWeek {
  weekStartingOn: CalendarDate;
  sessions: readonly TrainingSession[];
  /** Summary of muscle exposure for this week. */
  muscleExposure?: Readonly<Record<MuscleId, number>>;
}

export type SessionDayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface TrainingSession {
  id: EntityId;
  /** User-local date of this session. */
  date: CalendarDate;
  /** Day name for display. */
  dayName: SessionDayName;
  /** Position within the week (0 = first session day). */
  weekPosition: number;
  name: string;
  /** Exercises planned for this session, in order. */
  exercises: readonly PlannedExercise[];
  /** Estimated duration in minutes. */
  estimatedDurationMinutes: number;
  /** Target duration (user's max or session-specific target). */
  targetDurationMinutes: number;
  /** Notes for this session. */
  notes?: string;
}

export interface TrainingBlock {
  id: EntityId;
  name: string;
  /** First week of the block. */
  startsOn: CalendarDate;
  /** Number of weeks in the block. */
  weekCount: number;
  /** Focus or theme of the block. */
  focus?: string;
  weeks: readonly TrainingWeek[];
}

export interface TrainingSlot {
  /** Position within the session. */
  position: number;
  /** Planned exercise. */
  exercise: PlannedExercise;
}

export interface PlannedExercise {
  id: EntityId;
  exerciseId: ExerciseId;
  position: number;
  /** Exercise name at plan creation time. */
  name: string;
  /** Exercise variation label at plan creation time. */
  variationLabel?: string;
  /** Target sets. */
  targetSets: number;
  /** Rep range. */
  repMin?: number;
  repMax?: number;
  /** Target RIR. */
  targetRir?: number;
  /** Rest in seconds. */
  restSeconds?: number;
  /** Order within the session. */
  order: number;
  /** The role this exercise serves in the plan. */
  planRole: string;
  /** Why this exercise was selected. */
  selectionReason: string;
  /** Phase 2 ExerciseDecision snapshot. */
  exerciseDecisionSnapshot?: ExerciseDecisionSnapshot;
  /** Viable substitution ids (from Phase 2). */
  substitutionExerciseIds: readonly ExerciseId[];
  /** Knowledge version at time of planning. */
  knowledgeVersion: number;
  /** Notes. */
  notes?: string;
}

export interface ExerciseDecisionSnapshot {
  exerciseId: ExerciseId;
  tier: string;
  score: number;
  primaryTargets: readonly string[];
  secondaryTargets: readonly string[];
  equipmentCompatibility: string;
  roles: readonly string[];
  movementFunctions: readonly string[];
  knowledgeVersion: number;
  selectionReasons: readonly string[];
  confidence: number;
  // -- Phase 3.1 environment fields (optional; absent for gym-native picks) --
  /** Environment the snapshot was taken in, when it constrained selection. */
  environmentKind?: TrainingEnvironmentKind;
  /** The exercise this one replaced because the environment could not do it. */
  substitutedFromExerciseId?: ExerciseId;
  /** How similar the replacement's stimulus is to the original, 0..1. */
  stimulusSimilarity?: number;
  /** Muscle slugs still trained at (nearly) the same purpose. */
  coveragePreserved?: readonly string[];
  /** Muscle slugs the environment cannot reproduce — stated, never hidden. */
  coverageLost?: readonly string[];
  /** Explicit honesty label: not every home swap equals the gym movement. */
  equivalence?: EnvironmentEquivalence;
}

/**
 * Scientific-honesty label for an environment-driven substitution.
 *
 * `equivalent` is reserved for a replacement that keeps the same primary
 * muscles, movement function and load-progression mechanism; anything less is
 * `partial`, and a replacement that drops a muscle `reduced`. The planner must
 * never describe a `partial`/`reduced` swap as if it were the same movement.
 */
export type EnvironmentEquivalence = "equivalent" | "partial" | "reduced";

export interface PlannedSet {
  id: EntityId;
  plannedExerciseId: EntityId;
  setNumber: number;
  kind: string;
  targetLoadKg?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  targetRir?: number;
  restSeconds?: number;
  order: number;
}

export type ProgressionAction = "progress_load" | "progress_reps" | "maintain" | "regress" | "hold" | "repeat" | "modify_target" | "reduce_stimulus";

export interface ProgressionRule {
  id: EntityId;
  exerciseId: ExerciseId;
  /** Trigger condition. */
  trigger: string;
  /** Condition description. */
  condition: string;
  /** Action to take. */
  action: ProgressionAction;
  /** Bound description. */
  bounds: string;
  /** Reset/adjustment behavior. */
  resetBehavior?: string;
  /** Rationale. */
  rationale: string;
  /** Configuration version. */
  configurationVersion: string;
}

export type PlanChangeKind =
  | "no_change"
  | "progress_load"
  | "progress_reps"
  | "adjust_volume"
  | "adjust_frequency"
  | "replace_exercise"
  | "redistribute_exercise"
  | "adjust_session"
  | "revise_split"
  | "modify_progression"
  | "reduce_training_stress";

export interface PlanChange {
  kind: PlanChangeKind;
  /** Human-readable description. */
  description: string;
  /** What changed. */
  affectedExercises?: readonly ExerciseId[];
  affectedMuscles?: readonly string[];
  /** Reason for the change. */
  reason: string;
  /** Evidence that triggered the change. */
  evidence?: string;
  /** Confidence in the change. */
  confidence?: number;
}

export interface PlanDecision {
  id: EntityId;
  planVersionId: EntityId;
  timestamp: Timestamp;
  /** The decision kind. */
  decision: PlanChangeKind;
  /** Reason codes. */
  reasonCodes: readonly string[];
  /** Evidence summary. */
  evidence: string;
  /** Constraints that were satisfied. */
  satisfiedConstraints: readonly string[];
  /** Constraints that were violated (should be empty for feasible plans). */
  violatedConstraints: readonly string[];
  /** Muscles affected by this decision. */
  affectedMuscles: readonly string[];
  /** Exercises affected. */
  affectedExercises: readonly ExerciseId[];
  /** Before state (plan summary). */
  before: PlanSummary;
  /** After state (plan summary). */
  after: PlanSummary;
  /** Confidence/quality metadata. */
  confidence?: number;
  /** Explicit assumptions made. */
  assumptions?: readonly string[];
}

export interface PlanSummary {
  planVersionId: EntityId;
  versionNumber: number;
  exerciseIds: readonly ExerciseId[];
  sessions: readonly SessionSummary[];
  totalExercises: number;
  totalSessions: number;
  estimatedWeeklyDurationMinutes: number;
}

export interface SessionSummary {
  sessionId: EntityId;
  date: CalendarDate;
  exerciseCount: number;
  estimatedDurationMinutes: number;
}

export interface PlanComparison {
  planAId: EntityId;
  planBId: EntityId;
  /** What changed. */
  changes: readonly PlanComparisonChange[];
  /** Muscle volume changes. */
  muscleVolumeChanges: readonly MuscleVolumeChange[];
  /** Frequency changes. */
  frequencyChanges: readonly FrequencyChange[];
  /** Exercise changes. */
  exerciseChanges: readonly ExerciseChange[];
  /** Session duration changes. */
  sessionDurationChanges: readonly SessionDurationChange[];
  /** Split changes. */
  splitChanges?: string;
  /** Progression changes. */
  progressionChanges?: string;
  /** Constraint changes. */
  constraintChanges?: string;
  /** Goal alignment changes. */
  goalAlignmentChanges?: string;
  /** Deterministic ordering key. */
  orderedBy: string;
  // -- Phase 3.1 environment comparison (optional) --
  /** Environment each side was trained in ("gym" vs "home_no_equipment"). */
  environmentChanges?: string;
  /** Exercise substitutions the environment forced, with honesty labels. */
  substitutions?: readonly SubstitutionChange[];
  /** Explicit stimulus limitations the comparison must not hide. */
  limitations?: readonly EnvironmentLimitation[];
  /** How the two plans progress load/reps/leverage, described per mechanism. */
  progressionMechanisms?: readonly ProgressionMechanismChange[];
}

export interface SubstitutionChange {
  originalExerciseId: ExerciseId;
  originalExerciseName: string;
  replacementExerciseId: ExerciseId;
  replacementExerciseName: string;
  /** Reason code, e.g. `equipment_unavailable` or `movement_pattern_unsupported`. */
  reason: string;
  equivalence: EnvironmentEquivalence;
  stimulusSimilarity: number;
  musclesPreserved: readonly string[];
  musclesLost: readonly string[];
  /** Human-readable relationship, e.g. "partial substitution". */
  relationship: string;
}

export interface ProgressionMechanismChange {
  exerciseId: ExerciseId;
  exerciseName: string;
  /** Order of progression levers, e.g. ["reps","variation"] vs ["load"]. */
  mechanisms: readonly string[];
  /** Whether external load is available as a progression lever. */
  loadAvailable: boolean;
}

export interface PlanComparisonChange {
  kind: PlanChangeKind;
  description: string;
  affectedExercises?: readonly ExerciseId[];
  affectedMuscles?: readonly string[];
}

export interface MuscleVolumeChange {
  muscleSlug: string;
  planAVolume: number;
  planBVolume: number;
  delta: number;
  direction: "increased" | "decreased" | "unchanged";
}

export interface FrequencyChange {
  muscleSlug: string;
  planAFrequency: number;
  planBFrequency: number;
  delta: number;
}

export interface ExerciseChange {
  exerciseId: ExerciseId;
  exerciseName: string;
  change: "added" | "removed" | "replaced" | "unchanged";
  replacementId?: ExerciseId | null;
}

export interface SessionDurationChange {
  sessionId: EntityId;
  planADuration: number;
  planBDuration: number;
  deltaMinutes: number;
}

export interface TrainingTarget {
  muscleId: MuscleId;
  muscleSlug: string;
  targetWeeklyVolume: number;
  targetWeeklyVolumeMin: number;
  targetWeeklyVolumeMax: number;
  targetWeeklyFrequency: number;
  rationale: string;
}

export interface MuscleVolumeTarget {
  /** Optional canonical muscle id; config tables are keyed by slug. */
  muscleId?: MuscleId;
  muscleSlug: string;
  /** Minimum useful weekly volume (effective sets). */
  min: number;
  /** Preferred weekly volume. */
  preferred: number;
  /** Upper caution boundary. */
  max: number;
  /** Goal profile this target belongs to. */
  goalProfile: TrainingGoalProfile;
  /** Experience level modifier. */
  experienceModifier: number;
}

export interface MuscleFrequencyTarget {
  muscleSlug: string;
  /** Minimum sessions per week this muscle should be trained. */
  min: number;
  /** Preferred sessions per week. */
  preferred: number;
  /** Maximum sensible frequency. */
  max: number;
  rationale: string;
}

export interface SessionDurationBudget {
  /** Maximum session duration from user profile. */
  maxMinutes: number;
  /** Warm-up time allocation. */
  warmupMinutes: number;
  /** Transition time per exercise. */
  transitionSecondsPerExercise: number;
  /** Rest time per set (average). */
  restSecondsPerSet: number;
  /** Logging overhead. */
  loggingMinutes: number;
}

// ---------------------------------------------------------------------------
// Training constraint model
// ---------------------------------------------------------------------------

export type ConstraintResult = "satisfied" | "violated" | "warning";

export interface TrainingConstraint {
  id: string;
  kind: string;
  /** Human-readable label. */
  label: string;
  /** Whether this is a hard constraint (must be satisfied) or soft. */
  isHard: boolean;
  /** Result after plan evaluation. */
  result?: ConstraintResult;
  /** Violation detail if result is "violated". */
  violationDetail?: string;
  /** Warning detail if result is "warning". */
  warningDetail?: string;
}

export interface PlanConstraints {
  /** All constraints evaluated against a plan. */
  constraints: readonly TrainingConstraint[];
  /** Overall feasibility. */
  feasibility: PlanFeasibility;
}

export type PlanFeasibility = "feasible" | "feasible_with_tradeoffs" | "infeasible";

export interface PlanInfeasibility {
  /** Why the plan cannot be generated. */
  reason: string;
  /** Specific constraints that conflict. */
  conflictingConstraints: readonly string[];
  /** Suggested resolutions. */
  suggestions?: readonly string[];
}

// ---------------------------------------------------------------------------
// Effective volume model
// ---------------------------------------------------------------------------

export interface EffectiveSetContribution {
  exerciseId: ExerciseId;
  muscleId: MuscleId;
  plannedSetId: EntityId;
  relationshipRole: string;
  contributionCoefficient: number;
  effectiveSets: number;
  rationale: string;
}

export interface MuscleVolumeContribution {
  muscleId: MuscleId;
  muscleSlug: string;
  directEffectiveSets: number;
  indirectEffectiveSets: number;
  supportingEffectiveSets: number;
  stabilizingEffectiveSets: number;
  emphasisEffectiveSets: number;
  totalEffectiveSets: number;
  contributingExercises: readonly string[];
}

export interface WeeklyVolumeReport {
  byMuscle: readonly MuscleVolumeContribution[];
  totalPlannedSets: number;
  totalEffectiveSets: number;
  underTargetMuscles: readonly string[];
  potentiallyExcessiveMuscles: readonly string[];
  redundantExposure: readonly string[];
}

// ---------------------------------------------------------------------------
// Adaptation and plateau signals
// ---------------------------------------------------------------------------

export type PlateauSignalKind =
  | "repeated_performance_stagnation"
  | "declining_performance"
  | "planned_vs_completed_gap"
  | "excessive_volume_signal"
  | "insufficient_volume_signal"
  | "frequency_mismatch"
  | "exercise_specific_stagnation"
  | "session_duration_overload"
  | "adherence_issue";

export interface PlateauSignal {
  kind: PlateauSignalKind;
  /** What was observed. */
  observation: string;
  /** Affected exercise or muscle. */
  affectedEntity?: string;
  /** Magnitude/severity. */
  severity?: number;
  /** Weeks over which the signal was observed. */
  observedWeeks?: number;
}

export type AdaptationOutcome =
  | "no_change"
  | "progress_load"
  | "progress_reps"
  | "adjust_volume"
  | "adjust_frequency"
  | "replace_exercise"
  | "redistribute_exercise"
  | "adjust_session"
  | "revise_split"
  | "modify_progression"
  | "reduce_training_stress";

export interface AdaptationDecision {
  outcome: AdaptationOutcome;
  /** Why this outcome was chosen. */
  rationale: string;
  /** Signals that triggered this adaptation. */
  triggeringSignals: readonly PlateauSignal[];
  /** Planned changes. */
  changes: readonly PlanChange[];
  /** What will be monitored after this change. */
  monitoringPlan?: readonly string[];
  /** Why this was the smallest useful change (or why no change). */
  smallestUsefulChangeJustification?: string;
}

// ---------------------------------------------------------------------------
// Training state — for the future Unified FitCoach State
// ---------------------------------------------------------------------------

export interface TrainingState {
  /** Current plan version. */
  currentPlanVersionId?: EntityId | null;
  /** Current plan status. */
  currentPlanStatus?: string | null;
  /** Training goal. */
  trainingGoalKind?: string | null;
  /** Weekly session frequency. */
  weeklySessionFrequency?: number;
  /** Session frequency (sessions per week). */
  sessionFrequencyPerWeek?: number;
  /** Muscle frequency (sessions per week per muscle). */
  muscleFrequencyPerWeek?: Readonly<Record<string, number>>;
  /** Planned weekly volume per muscle. */
  plannedWeeklyVolumePerMuscle?: Readonly<Record<string, number>>;
  /** Effective weekly volume per muscle. */
  effectiveWeeklyVolumePerMuscle?: Readonly<Record<string, number>>;
  /** Completed weekly volume per muscle. */
  completedWeeklyVolumePerMuscle?: Readonly<Record<string, number>>;
  /** Exercise distribution across sessions. */
  exerciseDistribution?: readonly ExerciseDistributionEntry[];
  /** Progression status per exercise. */
  progressionStatus?: Readonly<Record<string, ProgressionStatus>>;
  /** Performance trends. */
  performanceTrends?: Readonly<Record<string, string>>;
  /** Adherence (completed vs planned sessions). */
  adherence?: number;
  /** Recovery constraints known to training. */
  recoveryConstraints?: readonly string[];
  /** Plateau signals. */
  plateauSignals?: readonly PlateauSignal[];
  /** Plan quality. */
  planQuality?: PlanQuality;
  /** Constraint violations. */
  constraintViolations?: readonly string[];
  /** Current interventions. */
  currentInterventions?: readonly string[];
  /** Recent changes. */
  recentChanges?: readonly PlanChange[];
  /** Confidence/reliability. */
  confidence?: number;
  // -- Phase 3.1 continuity facts (structured; no cross-domain reasoning) --
  /** Active training environment (or the default gym environment). */
  environment?: TrainingEnvironment;
  /** Recorded environment changes, newest first. */
  environmentChanges?: readonly TrainingEnvironmentPeriod[];
  /** Equipment ids usable in the active environment. */
  availableEquipmentIds?: readonly string[];
  /** Constraints the active environment imposes on the plan. */
  temporaryConstraints?: readonly EnvironmentLimitation[];
  /** Per-exercise performed history summary (evidence, not a score). */
  performanceHistory?: Readonly<Record<string, ExercisePerformanceSummary>>;
  /** Progression recommendations currently outstanding. */
  progressionRecommendations?: readonly ProgressionRecommendation[];
  /** Completed (recommended → accepted → evidenced) progressions by exercise. */
  completedProgressions?: Readonly<Record<string, number>>;
  /** Sessions completed in an adapted (non-plan) environment. */
  adaptedSessions?: number;
  /** Planned sessions with no completed training in the trailing window. */
  missedSessions?: number;
  /** Sessions completed at home (any non-gym environment). */
  homeSessions?: number;
}

export interface ExerciseDistributionEntry {
  exerciseId: ExerciseId;
  exerciseName: string;
  sessionsPerWeek: number;
  totalWeeklySets: number;
  primaryMuscles: readonly string[];
}

export interface ProgressionStatus {
  exerciseId: ExerciseId;
  exerciseName: string;
  currentLoadKg?: number;
  currentRepRange?: string;
  currentRirTarget?: number;
  lastProgressionDate?: CalendarDate | null;
  /**
   * Progressions that were recommended, accepted AND evidenced by a later
   * performance — never a raw recommendation counter. See
   * `countCompletedProgressions` in `@fitcoach/fitness-core`.
   */
  progressionsCompleted: number;
  status: "progressing" | "holding" | "stalled" | "regressing" | "unknown";
  nextProgressionTarget?: string;
  // -- Phase 3.1 ledger fields (optional) --
  /** Most recent deterministic evaluation outcome, e.g. `increase_load`. */
  latestEvaluation?: ProgressionEvaluationOutcome;
  /** Most recent decision recorded for this exercise. */
  latestDecision?: ProgressionDecisionKind;
  /** Recommendations produced but not yet decided by the user. */
  recommendationsPending?: number;
  /** Recommendations the user rejected. */
  recommendationsRejected?: number;
  /** Progressions recommended but not (yet) evidenced. */
  recommendationsUnproven?: number;
  /** Whether progression currently depends on external load. */
  loadAvailable?: boolean;
  /** Ordered progression levers available for this exercise. */
  progressionMechanisms?: readonly string[];
}

export interface PlanQuality {
  goalAlignment: number;
  muscleCoverage: number;
  volumeAppropriateness: number;
  frequencyAppropriateness: number;
  exerciseSuitability: number;
  redundancy: number;
  equipmentFeasibility: number;
  preferenceCompatibility: number;
  sessionDuration: number;
  progressionReadiness: number;
  constraintSatisfaction: number;
  /** Weighted total — decomposable, not mystical. */
  total: number;
  /** Component weights used. */
  weights: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TrainingConfiguration {
  /** Configuration version for reproducibility. */
  version: string;
  /** Volume target ranges per goal profile + experience. */
  muscleVolumeTargets: Readonly<Record<string, MuscleVolumeTarget>>;
  /** Frequency targets per muscle. */
  muscleFrequencyTargets: Readonly<Record<string, MuscleFrequencyTarget>>;
  /** Session duration budgeting. */
  sessionDurationBudget: SessionDurationBudget;
  /** Effective set contribution coefficients. */
  effectiveSetCoefficients: EffectiveSetCoefficients;
  /** Progression rules configuration. */
  progressionConfiguration: ProgressionConfiguration;
  /** Plan quality weights. */
  planQualityWeights: Readonly<Record<string, number>>;
  /** Adaptation thresholds. */
  adaptationThresholds: AdaptationThresholds;
  /** Split generation preferences. */
  splitConfiguration: SplitConfiguration;
}

export interface EffectiveSetCoefficients {
  /** Direct (primary_mover) contribution coefficient. */
  direct: number;
  /** Indirect (secondary_mover) contribution coefficient. */
  indirect: number;
  /** Supporting contribution coefficient. */
  supporting: number;
  /** Stabilizing contribution coefficient. */
  stabilizer: number;
  /** Emphasis (structure-level) contribution coefficient. */
  emphasis: number;
  /** Overlap penalty when two exercises share the same primary muscle. */
  sameMuscleOverlapPenalty: number;
  /** Compound exercise indirect contribution cap (fraction of direct). */
  compoundIndirectCap: number;
}

export interface ProgressionConfiguration {
  /** Configuration version for reproducibility of historical decisions. */
  version?: string;
  /** Default RIR target for hypertrophy work. */
  defaultRirTarget: number;
  /** Rep range for hypertrophy work. */
  hypertrophyRepMin: number;
  hypertrophyRepMax: number;
  /** Rep range for strength work. */
  strengthRepMin: number;
  strengthRepMax: number;
  /** Load increment in kg for progression. */
  loadIncrementKg: number;
  /** Reps to add before increasing load. */
  repsToAddBeforeLoad: number;
  /** Sessions at top of rep range before progressing. */
  sessionsAtTopBeforeProgress: number;
  /** Maximum progressions per week per exercise. */
  maxProgressionsPerWeek: number;
  /** Deload threshold: consecutive stalled sessions. */
  deloadStalledSessionThreshold: number;
  /** Minimum RIR to consider progression. */
  minRirForProgression: number;
}

export interface AdaptationThresholds {
  /** Configuration version for reproducibility of historical decisions. */
  version?: string;
  /** Sessions below target completion rate before flagging adherence issue. */
  adherenceThreshold: number;
  /** Consecutive stalled sessions before plateau signal. */
  stagnationThreshold: number;
  /** Volume delta % to consider adjustment. */
  volumeAdjustmentThresholdPercent: number;
  /** Frequency delta to consider adjustment. */
  frequencyAdjustmentThreshold: number;
  /** Under-target volume fraction before flagging. */
  underTargetFraction: number;
  /** Over-target volume fraction before flagging. */
  overTargetFraction: number;
}

export interface SplitConfiguration {
  /** Configuration version for reproducibility of historical decisions. */
  version?: string;
  /** Minimum sessions per week for full-body split. */
  fullBodyMinSessions: number;
  /** Maximum sessions per week for full-body split. */
  fullBodyMaxSessions: number;
  /** Sessions per week for upper/lower. */
  upperLowerSessions: number;
  /** Sessions per week for push/pull/legs. */
  pushPullLegsSessions: number;
  /** Maximum exercises per session by duration bracket. */
  maxExercisesPerSession: Readonly<Record<string, number>>;
  /** Minimum exercises for a meaningful session. */
  minExercisesPerSession: number;
}

// ---------------------------------------------------------------------------
// Explainability — structured reasons
// ---------------------------------------------------------------------------

export type PlanReasonCode =
  | "GOAL_ALIGNMENT"
  | "MUSCLE_COVERAGE"
  | "COMBINES_EXISTING_EXERCISE"
  | "EQUIPMENT_AVAILABLE"
  | "USER_PREFERENCE"
  | "HISTORY_CONTINUITY"
  | "REDUNDANCY_REDUCTION"
  | "SESSION_DURATION"
  | "PROGRESSION_CONTINUITY"
  | "RECOVERY_CONSTRAINT"
  | "WEAK_POINT_PRIORITY"
  | "NO_CHANGE_BECAUSE_PROGRESSING"
  | "NO_CHANGE_BECAUSE_CONSTRAINTS_SATISFIED"
  | "NO_CHANGE_BECAUSE_EVIDENCE_WEAK"
  | "SUBSTITUTION_FOR_EQUIPMENT"
  | "SUBSTITUTION_FOR_PREFERENCE"
  | "VOLUME_ADJUSTMENT"
  | "FREQUENCY_ADJUSTMENT"
  | "EXERCISE_REPLACEMENT"
  | "SPLIT_ADJUSTMENT"
  | "FEASIBILITY_TRADEOFF";

export interface ExerciseSelectionReason {
  code: PlanReasonCode;
  explanation: string;
  /** Weight/importance of this reason. */
  weight?: number;
}

// ---------------------------------------------------------------------------
// Legacy Phase 1 planning/logging contracts
//
// Retained unchanged so existing repositories, services and workout logging
// keep compiling. Phase 3 supersedes TrainingPlan with the versioned plan
// model above; these types describe the original plan-template and workout-
// logging records.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase 3.1 — Training environment (first-class domain input)
//
// The environment is NOT a goal. A user's goal survives a week without a gym;
// only the exercise universe, the available load and the progression levers
// change. It is modelled here as an interval-versioned period, exactly like
// equipment and preferences, so "what could the user do on that day?" stays
// answerable after the fact.
// ---------------------------------------------------------------------------

export type TrainingEnvironmentKind =
  | "gym"
  | "home"
  | "home_no_equipment"
  | "home_limited_equipment"
  | "hotel"
  | "travel"
  | "outdoor"
  | "custom";

/** One recorded environment interval. Closed intervals stay as history. */
export interface TrainingEnvironmentPeriod {
  id: EntityId;
  userId: UserId;
  kind: TrainingEnvironmentKind;
  /** Equipment ids explicitly available (overrides the environment default). */
  availableEquipmentIds: readonly string[];
  /** Equipment ids explicitly unavailable even if owned. */
  unavailableEquipmentIds: readonly string[];
  /** User-local day this environment starts (inclusive). */
  effectiveFrom: CalendarDate;
  /** User-local day it ends (exclusive); absent = still in force. */
  effectiveTo?: CalendarDate | null;
  reason?: string;
  /** True when the change is expected to end (a trip, not a move). */
  isTemporary: boolean;
  notes?: string;
  createdAt: Timestamp;
}

/** The environment resolved for a specific day. */
export interface TrainingEnvironment {
  kind: TrainingEnvironmentKind;
  availableEquipmentIds: readonly string[];
  unavailableEquipmentIds: readonly string[];
  effectiveFrom: CalendarDate;
  effectiveTo?: CalendarDate | null;
  reason?: string;
  isTemporary: boolean;
  /** True when the environment withholds equipment the user normally uses. */
  constrained: boolean;
  /** Provenance: the platform default or a recorded period. */
  source: "default" | "period";
  /** Human-readable, deterministic summary of what is missing. */
  limitations: readonly EnvironmentLimitation[];
}

/** A stimulus the environment cannot reproduce. Stated, never papered over. */
export interface EnvironmentLimitation {
  kind:
    | "muscle_coverage"
    | "movement_pattern"
    | "load_progression"
    | "equipment"
    | "exercise_universe";
  /** Muscle slug, movement pattern or equipment id the limitation applies to. */
  subject: string;
  description: string;
  /** 0..1 — how much of the intended stimulus is believed to remain. */
  retainedStimulus: number;
}

// ---------------------------------------------------------------------------
// Phase 3.1 — Performance records and the progression ledger
// ---------------------------------------------------------------------------

/** How a recorded set was loaded. Bodyweight is load, not "no data". */
export type PerformanceLoadKind =
  | "external_load"
  | "bodyweight"
  | "weighted_bodyweight"
  | "assisted_bodyweight"
  | "band"
  | "none";

/** Where a performance record came from. */
export type PerformanceSource = "manual" | "imported" | "inferred";

/**
 * How a workout relates to the plan it points at. `adapted` is a REAL training
 * session performed in a different environment; it counts as training, but it
 * is not silently equated with the planned session.
 */
export type SessionClassification =
  | "planned"
  | "adapted"
  | "makeup"
  | "unplanned";

/** A completed progression evaluation outcome (deterministic). */
export type ProgressionEvaluationOutcome =
  | "increase_load"
  | "increase_reps"
  | "maintain"
  | "repeat"
  | "reduce_load"
  | "reduce_target"
  | "modify_rep_range"
  | "modify_rir_target"
  | "change_exercise"
  | "no_change"
  | "insufficient_data";

/** What the user did with a recommendation. */
export type ProgressionDecisionKind = "recommended" | "accepted" | "rejected" | "deferred";

/** One performed set, flattened into the shape the ledger engine consumes. */
export interface PerformanceObservation {
  /** Set id (or a caller-supplied stable id). */
  id: EntityId;
  exerciseId: ExerciseId;
  planVersionId?: EntityId;
  slotId?: EntityId;
  workoutId?: WorkoutId;
  setKind: string;
  loadKind: PerformanceLoadKind;
  /** External load moved, kg. */
  loadKg?: number;
  /** Extra load attached to a bodyweight movement, kg. */
  addedLoadKg?: number;
  /** Assistance that reduced effective load, kg. */
  assistanceKg?: number;
  reps?: number;
  /** The prescription this set was performed against. */
  targetRepMin?: number;
  targetRepMax?: number;
  rir?: number;
  rpe?: number;
  /** True when the set was actually completed (vs. attempted and failed). */
  completed: boolean;
  performedAt: Timestamp;
  localDate: CalendarDate;
  environmentKind?: TrainingEnvironmentKind;
  classification?: SessionClassification;
  substitutedFromExerciseId?: ExerciseId;
  source: PerformanceSource;
  notes?: string;
}

/** A compact, deterministic summary of one exercise's recent performance. */
export interface ExercisePerformanceSummary {
  exerciseId: ExerciseId;
  /** Sets actually completed in the window. */
  completedSets: number;
  /** Sessions where the exercise was attempted but not completed. */
  incompleteSessions: number;
  sessionsObserved: number;
  bestReps?: number;
  bestLoadKg?: number;
  latestLoadKind?: PerformanceLoadKind;
  latestRir?: number;
  latestLocalDate?: CalendarDate;
  trend?: string;
  /** Ordered progression levers available, e.g. ["load","reps"]. */
  mechanisms: readonly string[];
}

/** The deterministic recommendation produced by one evaluation. */
export interface ProgressionRecommendation {
  outcome: ProgressionEvaluationOutcome;
  /** The plan-level action the outcome maps to. */
  action: ProgressionAction;
  /** Concrete target the user is asked to try. */
  targetLoadKg?: number;
  targetAddedLoadKg?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  targetRir?: number;
  /** Set when the recommendation is to move to a harder variation. */
  targetExerciseId?: ExerciseId;
  /** Ordered levers that remain available, e.g. ["reps","rir","variation"]. */
  mechanisms: readonly string[];
  rationale: string;
  evidence: readonly string[];
  confidence: number;
  configVersion: string;
}

/** What actually changed after a recommendation was accepted. */
export interface ProgressionActualChange {
  kind: "load" | "added_load" | "reps" | "variation" | "none";
  loadDeltaKg?: number;
  addedLoadDeltaKg?: number;
  repsDelta?: number;
  fromExerciseId?: ExerciseId;
  toExerciseId?: ExerciseId;
}

/** An immutable evaluation row in the progression ledger. */
export interface ProgressionEvaluation {
  id: EntityId;
  userId: UserId;
  exerciseId: ExerciseId;
  exerciseName: string;
  planId?: TrainingPlanId;
  planVersionId?: EntityId;
  slotId?: EntityId;
  environmentKind?: TrainingEnvironmentKind;
  /** The observation that triggered the evaluation (the "current" set). */
  current: PerformanceObservationSummary;
  /** The observation it is compared against (the "previous" set). */
  previous?: PerformanceObservationSummary;
  /** Snapshot of the summary the evaluation used. */
  performance: ExercisePerformanceSummary;
  outcome: ProgressionEvaluationOutcome;
  recommendation: ProgressionRecommendation;
  evidence: readonly string[];
  /** Deterministic dedupe key: identical inputs produce the same key. */
  fingerprint: string;
  configVersion: string;
  createdAt: Timestamp;
}

/** The reduced observation stored alongside an evaluation. */
export interface PerformanceObservationSummary {
  loadKind: PerformanceLoadKind;
  loadKg?: number;
  addedLoadKg?: number;
  assistanceKg?: number;
  reps?: number;
  rir?: number;
  localDate: CalendarDate;
  environmentKind?: TrainingEnvironmentKind;
}

/** An immutable decision/outcome event attached to one evaluation. */
export interface ProgressionDecisionEvent {
  id: EntityId;
  evaluationId: EntityId;
  /** Stable idempotency key for the submission. */
  idempotencyKey?: string;
  /** `recommended` is the initial state written with the evaluation. */
  decision: ProgressionDecisionKind;
  reason?: string;
  actualChange?: ProgressionActualChange;
  /** Performance observed after the change was made, when known. */
  resultingPerformance?: PerformanceObservationSummary;
  evidence: readonly string[];
  createdAt: Timestamp;
}

/** The flattened ledger read model: evaluation + its latest decision event. */
export interface ProgressionLedgerEntry {
  evaluation: ProgressionEvaluation;
  /** All events for this evaluation, oldest first. */
  events: readonly ProgressionDecisionEvent[];
  /** The latest decision, defaulting to `recommended`. */
  decision: ProgressionDecisionKind;
  actualChange?: ProgressionActualChange;
  resultingPerformance?: PerformanceObservationSummary;
  /** True only when a recommendation was accepted AND later evidenced. */
  completed: boolean;
}

/** Bumped when the ledger semantics change; never silently redefined. */
export const PROGRESSION_LEDGER_VERSION = "fitcoach.progression.v1";

/** Bumped when environment semantics change; never silently redefined. */
export const ENVIRONMENT_VERSION = "fitcoach.environment.v1";
