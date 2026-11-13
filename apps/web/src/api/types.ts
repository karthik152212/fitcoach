/**
 * FitCoach API DTO types — the shapes the UI consumes from /v0.
 * These mirror the backend contracts; the backend remains the source of truth.
 */

export type CalendarDate = string;

export interface User {
  id: string;
  email?: string;
  displayName: string;
  timezone: string;
}

export interface Profile {
  birthDate?: CalendarDate;
  sex?: "male" | "female" | "intersex" | "undisclosed";
  heightCm?: number;
  trainingExperience?: "untrained" | "beginner" | "intermediate" | "advanced";
  trainingDaysPerWeek?: number;
  sessionDurationMinutes?: number;
  limitations?: readonly string[];
  unitSystem?: "metric" | "imperial";
}

export type GoalKind =
  | "bodybuilding"
  | "aesthetics_v_taper"
  | "lean_recomposition"
  | "athletic_performance"
  | "max_strength"
  | "general_fitness"
  | "custom";

export interface Goal {
  id: string;
  kind: GoalKind;
  status?: string;
  description?: string;
  priorities?: readonly string[];
  effectiveFrom?: CalendarDate;
}

export interface EquipmentItem {
  id: string;
  slug: string;
  name: string;
  category: string;
}

/** A row of the user's own equipment availability (nested catalog record). */
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

export type MeasurementEntry = "manual" | "smart_scale_import" | "wearable_import" | "other";

export type MeasurementConfidence = "measured" | "label_declared" | "estimated" | "unknown";

/** One measurement occasion: several values recorded at the same moment. */
export interface BodyMeasurement {
  id: string;
  userId: string;
  recordedAt: string;
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  circumferencesCm: Partial<Record<BodySite, number>>;
  enteredVia?: MeasurementEntry;
  confidence?: MeasurementConfidence;
  sourceName?: string;
  externalId?: string;
  photoRefs: string[];
  notes?: string;
  createdAt: string;
}

export interface NewBodyMeasurement {
  recordedAt?: string;
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  circumferencesCm?: Partial<Record<BodySite, number>>;
  enteredVia?: MeasurementEntry;
  confidence?: MeasurementConfidence;
  sourceName?: string;
  externalId?: string;
  notes?: string;
}

export interface UserEquipment {
  id: string;
  equipment: { id: string; slug: string; name: string; category: string };
  availability: string;
  validFrom: CalendarDate;
}

export type TrainingEnvironmentKind =
  | "gym"
  | "home"
  | "home_no_equipment"
  | "home_limited_equipment"
  | "hotel"
  | "travel"
  | "outdoor"
  | "custom";

export interface EnvironmentLimitation {
  kind: "muscle_coverage" | "movement_pattern" | "load_progression" | "equipment";
  subject: string;
  description: string;
  retainedStimulus?: number;
}

export interface TrainingEnvironment {
  kind: TrainingEnvironmentKind;
  availableEquipmentIds: readonly string[];
  unavailableEquipmentIds: readonly string[];
  effectiveFrom: CalendarDate;
  effectiveTo?: CalendarDate;
  reason?: string;
  isTemporary: boolean;
  constrained: boolean;
  source: string;
  limitations: readonly EnvironmentLimitation[];
}

export interface ExerciseSummary {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  movementPattern?: string;
  /** First-party coaching copy — the concise focus shown under the target. */
  instructions?: string;
  requiredEquipmentIds: string[];
  variationKey?: string;
  variationLabel?: string;
  unilateral?: boolean;
  loadingCharacteristic?: string;
  stabilityDemand?: string;
  rangeOfMotionCharacteristic?: string;
}

export interface TargetMapStructure {
  structureId: string;
  structureSlug: string;
  displayName: string;
  kind: string;
  state: TargetState;
  emphasis?: string;
}

export type TargetState = "primary" | "secondary" | "supporting" | "stabilizer";

export interface TargetMapEntry {
  muscleId: string;
  muscleSlug: string;
  displayName: string;
  group: string;
  state: TargetState;
  emphasis?: string;
  structures: readonly TargetMapStructure[];
}

export interface TargetMap {
  entries: readonly TargetMapEntry[];
}

export interface FormGuidanceStep {
  key: string;
  heading: string;
  body: string;
  position: number;
}

export interface FormGuidance {
  exerciseId?: string;
  version: number;
  status?: string;
  steps: readonly FormGuidanceStep[];
  quickInstructions?: readonly { key?: string; text?: string; caption?: string }[];
  videoCaptions?: readonly { key: string; caption: string }[];
}

export interface MediaAsset {
  id: string;
  /** e.g. `anatomical_illustration`, `video` (video = asset dependency). */
  mediaType: string;
  angle?: string;
  storageKey: string;
  overlays?: readonly unknown[];
  status: string;
}

export interface ExerciseDetail {
  exercise: ExerciseSummary & {
    movementFunctions: readonly string[];
    primaryMovementFunction?: string;
    roles: readonly string[];
    targets?: readonly unknown[];
  };
  formGuidance?: FormGuidance;
  media: readonly MediaAsset[];
  targetMap: TargetMap;
  curatedSubstitutions?: readonly unknown[];
}

export interface PlannedExercise {
  id: string;
  exerciseId: string;
  position: number;
  name: string;
  variationLabel?: string;
  targetSets: number;
  repMin: number;
  repMax: number;
  targetRir?: number;
  restSeconds?: number;
  order: number;
  planRole: string;
  selectionReason: string;
  substitutionExerciseIds: readonly string[];
}

export interface SessionPlanView {
  position: number;
  name: string;
  sessionType: string;
  suggestedDay?: string;
  weekdayHint?: number;
  exercises: readonly PlannedExercise[];
  estimatedMinutes: number;
  targetMinutes: number;
  exceedsBudget: boolean;
}

export interface EnvironmentSubstitution {
  originalExerciseId: string;
  originalExerciseName: string;
  replacementExerciseId: string;
  replacementExerciseName: string;
  reason: string;
  equivalence: "equivalent" | "partial" | "reduced";
  stimulusSimilarity: number;
  musclesPreserved: readonly string[];
  musclesLost: readonly string[];
  relationship: string;
}

export interface PlanConstraint {
  constraintKey: string;
  kind: string;
  label: string;
  isHard: boolean;
  result: "satisfied" | "warning" | "violated";
  warningDetail?: string;
  violationDetail?: string;
}

export interface GeneratePlanResult {
  feasibility: "feasible" | "feasible_with_tradeoffs" | "infeasible";
  infeasibilityReasons?: readonly string[];
  plan?: { id: string; kind: string; environmentKind?: string; versions: readonly unknown[] };
  version?: { id: string; versionNumber: number; configVersion: string };
  sessions?: readonly SessionPlanView[];
  quality?: { totalScore: number };
  constraints?: readonly PlanConstraint[];
  substitutions?: readonly EnvironmentSubstitution[];
  limitations?: readonly EnvironmentLimitation[];
  progressionMechanisms?: readonly string[];
  warnings: readonly string[];
}

export interface TemporaryPlanResult {
  needed: boolean;
  reason?: string;
  environment?: TrainingEnvironment;
  sourcePlanId?: string;
  sourceVersionId?: string;
  result?: GeneratePlanResult;
}

/**
 * One planned exercise inside a stored plan session — exactly what
 * `GET /v0/users/:id/training-plans/active` returns in `version.sessions[].slots`.
 * Names and rep ranges are resolved by the UI from the knowledge catalog.
 */
export interface PlanVersionSessionSlot {
  id: string;
  exerciseId: string;
  targetSets: number;
  targetRepRange?: { min: number; max: number };
  targetRir?: number;
  restSeconds?: number;
  substitutionExerciseIds?: readonly string[];
  /** Engine-authored plan role, e.g. `hypertrophy_movement`. */
  notes?: string;
}

/** A stored session of a plan version: `{ id, name, slots, weekdayHint }`. */
export interface PlanVersionSession {
  id: string;
  name: string;
  weekdayHint?: number;
  slots: readonly PlanVersionSessionSlot[];
}

export interface PlanVersion {
  id: string;
  planId: string;
  versionNumber: number;
  startsOn: CalendarDate;
  lifecycleStatus?: string;
  configVersion?: string;
  generationReason?: string;
  rationaleNotes?: string;
  sessions: readonly PlanVersionSession[];
}

export interface TrainingPlan {
  id: string;
  name?: string;
  /** `primary` or `temporary_environment` (Phase 3.1 §21). */
  kind: string;
  status: string;
  environmentKind?: TrainingEnvironmentKind;
  effectiveUntil?: CalendarDate;
  temporaryForVersionId?: string;
  versions: readonly PlanVersion[];
}

/** Per-exercise progression read-model from `GET /training-state`. */
export interface TrainingProgressionStatus {
  exerciseId: string;
  exerciseName: string;
  progressionsCompleted: number;
  status: string;
  nextProgressionTarget?: string;
}

/**
 * `GET /v0/users/:id/training-state` — the engine's read-model of the
 * current plan, its coverage, its progression status and its recent signals.
 * This is what drives the adaptive Home.
 */
export interface TrainingState {
  currentPlanVersionId: string | null;
  currentPlanStatus: string | null;
  trainingGoalKind: GoalKind | null;
  weeklySessionFrequency?: number;
  sessionFrequencyPerWeek?: number;
  plannedWeeklyVolumePerMuscle?: Record<string, number>;
  effectiveWeeklyVolumePerMuscle?: Record<string, number>;
  exerciseDistribution?: readonly {
    exerciseId: string;
    exerciseName: string;
    sessionsPerWeek: number;
    totalWeeklySets: number;
    primaryMuscles?: readonly string[];
  }[];
  /** Keyed by exercise id. */
  progressionStatus?: Record<string, TrainingProgressionStatus>;
  plateauSignals?: readonly PlateauSignal[];
  constraintViolations?: readonly { constraintKey?: string; label?: string; detail?: string }[];
  recentChanges?: readonly PlanChange[];
  confidence?: number;
  availableEquipmentIds?: readonly string[];
  environmentChanges?: readonly unknown[];
  progressionRecommendations?: readonly unknown[];
  adaptedSessions?: number;
  missedSessions?: number;
  homeSessions?: number;
  environment?: TrainingEnvironment;
}

/** A plateau signal raised by the deterministic engine. */
export interface PlateauSignal {
  exerciseId?: string;
  exerciseName?: string;
  kind?: string;
  detail?: string;
  message?: string;
  detectedOn?: CalendarDate;
}

/** A plan change surfaced by the engine (version change or adaptation). */
export interface PlanChange {
  id?: string;
  kind?: string;
  summary?: string;
  rationale?: string;
  createdAt?: string;
}

export type LoadKind = "external_load" | "bodyweight" | "weighted_bodyweight" | "assisted_bodyweight";

/** How a performed session relates to the plan (Phase 3 session classification). */
export type SessionClassification = "planned" | "adapted" | "makeup" | "unplanned";

export type WorkoutStatus = "planned" | "in_progress" | "completed" | "partial" | "skipped";

export interface Workout {
  id: string;
  planId?: string;
  status: WorkoutStatus;
  startedAt: string;
  endedAt?: string;
  title?: string;
  environmentKind?: TrainingEnvironmentKind;
  /** Engine classification: `planned`, `adapted`, `makeup` or `unplanned`. */
  sessionClassification?: SessionClassification;
}

export interface WorkoutExercise {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  sets?: readonly ExerciseSet[];
}

export interface ExerciseSet {
  id: string;
  workoutExerciseId: string;
  exerciseId?: string;
  position: number;
  kind: string;
  loadKind?: LoadKind;
  loadKg?: number;
  addedLoadKg?: number;
  assistanceLoadKg?: number;
  reps?: number;
  rir?: number;
  rpe?: number;
}

/** `GET /v0/users/:id/workouts/:id` → `{ workout: { workout, exercises } }`. */
export interface WorkoutAggregate {
  workout: Workout;
  exercises: readonly (WorkoutExercise & { sets: readonly ExerciseSet[] })[];
}

/**
 * `GET /v0/users/:id/workouts?limit=` returns the same `{ workout, exercises }`
 * pairs as the single-workout read, not bare workout rows.
 */
export interface WorkoutListEntry extends WorkoutAggregate {}

export interface PerformanceObservation {
  id: string;
  exerciseId: string;
  workoutId?: string;
  setKind?: string;
  loadKind: LoadKind;
  loadKg?: number;
  addedLoadKg?: number;
  assistanceKg?: number;
  reps?: number;
  rir?: number;
  completed: boolean;
  performedAt: string;
  localDate: CalendarDate;
  source?: string;
  environmentKind?: TrainingEnvironmentKind;
}

/** Per-exercise summary returned alongside observations. */
export interface PerformanceSummary {
  exerciseId: string;
  completedSets: number;
  incompleteSessions: number;
  sessionsObserved: number;
  bestReps?: number;
  bestLoadKg?: number;
  latestLoadKind?: LoadKind;
  latestLocalDate?: CalendarDate;
  trend?: string;
  mechanisms?: readonly string[];
}

export type ProgressionOutcome =
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

/**
 * `POST /v0/users/:id/progression/evaluate`.
 *
 * When there is no performed evidence the engine returns
 * `{ persisted: false, reason }` — an intentional outcome the UI must render
 * honestly rather than inventing a recommendation.
 */
export interface ProgressionEvaluationResult {
  persisted: boolean;
  reason?: string;
  evaluation?: {
    id?: string;
    exerciseId: string;
    exerciseName?: string;
    outcome: ProgressionOutcome;
    recommendation: {
      outcome: ProgressionOutcome;
      action?: string;
      rationale: string;
      mechanisms: readonly string[];
      evidence: readonly string[];
      confidence: number;
      targetLoadKg?: number;
      targetAddedLoadKg?: number;
      targetRepMin?: number;
      targetRepMax?: number;
      targetRir?: number;
      targetExerciseId?: string;
    };
    performance?: PerformanceSummary;
    evidence?: readonly string[];
    shouldProgress?: boolean;
    createdAt?: string;
  };
  entry?: {
    decision?: string;
    completed?: boolean;
    events?: readonly unknown[];
  };
}

export interface ContinuitySummary {
  environment: TrainingEnvironment;
  periods?: readonly unknown[];
  temporaryPlans: readonly {
    id: string;
    status?: string;
    kind?: string;
    environmentKind?: string;
    effectiveUntil?: CalendarDate;
  }[];
  sessions: {
    total: number;
    completed: number;
    adapted: number;
    home: number;
    skipped: number;
    open: number;
  };
  /** Planned sessions in the window with no performed workout. */
  missedSessions: number;
  completedProgressions?: { totalCompletedProgressions: number };
}

export interface LedgerEntry {
  evaluation: {
    id: string;
    exerciseId: string;
    exerciseName?: string;
    outcome: ProgressionOutcome;
    recommendation?: { rationale?: string };
    createdAt: string;
  };
  events?: readonly unknown[];
  decision: string;
  completed: boolean;
}

export interface ExerciseUniverseEntry {
  exercise: ExerciseSummary;
  available: boolean;
  missingEquipmentIds: readonly string[];
}

export interface ApiError {
  error: string;
  message?: string;
  path?: string;
}

// --- Nutrition / Food Search ----------------------------------------------------

export interface FoodServing {
  id: string;
  foodId: string;
  label: string;
  grams?: number;
  milliliters?: number;
  unitQuantity?: number;
  unitName?: string;
}

export interface FoodNutrientsPer100g {
  caloriesKcal?: number;
  proteinGrams?: number;
  carbohydrateGrams?: number;
  fatGrams?: number;
  fiberGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  alcoholGrams?: number;
  sodiumMilligrams?: number;
  potassiumMg?: number;
  cholesterolMg?: number;
  calciumMg?: number;
  ironMg?: number;
  vitaminAMcg?: number;
  vitaminCMg?: number;
  vitaminDMcg?: number;
  vitaminEMg?: number;
  vitaminKM?: number;
  thiaminMg?: number;
  riboflavinMg?: number;
  niacinMg?: number;
  vitaminB6Mg?: number;
  vitaminB12Mcg?: number;
  folateMcg?: number;
  magnesiumMg?: number;
  phosphorusMg?: number;
  zincMg?: number;
  copperMg?: number;
  manganeseMg?: number;
  seleniumMcg?: number;
  caffeineMg?: number;
  waterGrams?: number;
}

export interface Food {
  id: string;
  sourceId: string;
  name: string;
  brand?: string;
  densityBasis: "per_100g" | "per_100ml";
  nutrientsPer100g: FoodNutrientsPer100g;
  servings: FoodServing[];
  defaultServingId?: string;
  barcode?: string;
  externalId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchFoodsResponse {
  foods: Food[];
  total: number;
}

export interface SearchFoodsParams {
  q: string;
  limit?: number;
  offset?: number;
  sourceId?: string;
}

// --- Barcode Scanner -----------------------------------------------------------

export type BarcodeFormat = "EAN_13" | "EAN_8" | "UPC_A" | "UPC_E" | "CODE_128" | "CODE_39" | "ITF" | "QR_CODE" | "DATA_MATRIX" | "PDF_417" | "AZTEC";

export interface BarcodeScanResult {
  barcode: string;
  format: BarcodeFormat;
  timestamp: string;
}

export interface OpenFoodFactsProduct {
  code: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  brands_tags?: string[];
  categories?: string;
  categories_tags?: string[];
  ingredients_text?: string;
  ingredients_text_en?: string;
  image_url?: string;
  image_small_url?: string;
  nutriments?: {
    energy_kcal_100g?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    fiber_100g?: number;
    sugars_100g?: number;
    "saturated-fat_100g"?: number;
    sodium_100g?: number;
    salt_100g?: number;
    cholesterol_100g?: number;
    calcium_100g?: number;
    iron_100g?: number;
    vitamin_a_100g?: number;
    vitamin_c_100g?: number;
    vitamin_d_100g?: number;
    vitamin_e_100g?: number;
    vitamin_k_100g?: number;
    thiamin_100g?: number;
    riboflavin_100g?: number;
    niacin_100g?: number;
    vitamin_b6_100g?: number;
    vitamin_b12_100g?: number;
    folate_100g?: number;
    magnesium_100g?: number;
    phosphorus_100g?: number;
    zinc_100g?: number;
    potassium_100g?: number;
    caffeine_100g?: number;
    alcohol_100g?: number;
    water_100g?: number;
    trans_fat_100g?: number;
    polyunsaturated_fat_100g?: number;
    monounsaturated_fat_100g?: number;
  };
  serving_size?: string;
  serving_quantity?: number;
  serving_unit?: string;
  nutriscore_grade?: "a" | "b" | "c" | "d" | "e";
  nova_group?: 1 | 2 | 3 | 4;
  labels?: string;
  labels_tags?: string[];
  countries?: string;
  countries_tags?: string[];
  origins?: string;
  origins_tags?: string[];
  manufacturing_places?: string;
  manufacturing_places_tags?: string[];
  packaging?: string;
  packaging_tags?: string[];
  stores?: string;
  stores_tags?: string[];
  url?: string;
  _keywords?: string[];
  lang?: string;
  states?: string[];
  states_tags?: string[];
}

export interface OpenFoodFactsResponse {
  status: number;
  status_verbose: string;
  code: string;
  product?: OpenFoodFactsProduct;
}

export interface BarcodeLookupResponse {
  product: ScannedProductPreview | null;
  found: boolean;
  source: "openfoodfacts" | "local" | "unknown";
}

export interface ScannedProductPreview {
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  nutrientsPer100g: FoodNutrientsPer100g;
  servings: Array<{
    id: string;
    label: string;
    grams?: number;
    milliliters?: number;
    unitQuantity?: number;
    unitName?: string;
  }>;
  defaultServingId?: string;
  nutriscoreGrade?: "a" | "b" | "c" | "d" | "e";
  novaGroup?: 1 | 2 | 3 | 4;
  ingredients?: string;
  allergens?: string[];
  isFromOpenFoodFacts: boolean;
  confidence: "high" | "medium" | "low";
}

export interface NutritionAssessmentForProduct {
  product: ScannedProductPreview;
  servingGrams: number;
  assessment: {
    caloriesPercentOfTarget: number | null;
    proteinPercentOfTarget: number | null;
    carbsPercentOfTarget: number | null;
    fatPercentOfTarget: number | null;
    fiberPercentOfTarget: number | null;
    summary: string;
    flags: Array<{
      type: "calories" | "protein" | "carbs" | "fat" | "fiber" | "sodium" | "sugar" | "saturated_fat" | "ultra_processed";
      severity: "info" | "warning" | "alert";
      message: string;
    }>;
    recommendation: "add_to_log" | "consider_alternative" | "skip";
    reasoning: string;
  };
}

// --- Activity / Sleep / Recovery ----------------------------------------------

export type ActivityKind =
  | "steps"
  | "walk"
  | "run"
  | "cycle"
  | "row"
  | "swim"
  | "elliptical"
  | "stairs"
  | "sport"
  | "other";

export type ActivityEffort = "low" | "moderate" | "high";

export interface ActivityRecord {
  id: string;
  userId: string;
  date: CalendarDate;
  kind: ActivityKind;
  steps?: number;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: ActivityEffort;
  recordedVia?: string;
  externalId?: string;
  notes?: string;
  createdAt: string;
}

export interface NewActivityRecord {
  kind: ActivityKind;
  date?: CalendarDate;
  steps?: number;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: ActivityEffort;
  recordedVia?: string;
  externalId?: string;
  notes?: string;
}

export interface DailyActivitySummary {
  date: CalendarDate;
  steps: number;
  activeMinutes: number;
  cardioMinutes: number;
  trainingMinutes: number;
  estimatedEeKcal: number;
  sessions: readonly ActivityRecord[];
}

export interface ActivityTargets {
  dailyStepsTarget: number;
  weeklyCardioMinTarget: number;
  weeklyActiveMinTarget: number;
  basisNote: string;
}

export interface ActivityContext {
  averageSteps: number;
  weeklyCardioMinutes: number;
  averageActiveMinutes: number;
}

export type ObservationOrigin =
  | "wearable"
  | "manual"
  | "phone"
  | "partner_api"
  | "other";

export type ObservationConfidenceLevel = "high" | "medium" | "low";

export interface SleepObservation {
  id: string;
  userId: string;
  date: CalendarDate;
  startedAt: string;
  endedAt: string;
  timeInBedMinutes?: number;
  asleepMinutes?: number;
  efficiency?: number;
  latencyMinutes?: number;
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  awakeMinutes?: number;
  awakenings?: number;
  source: string;
  origin?: ObservationOrigin;
  externalId?: string;
  confidence: ObservationConfidenceLevel;
  notes?: string;
  createdAt: string;
}

export interface NewSleepObservation {
  date?: CalendarDate;
  startedAt: string;
  endedAt: string;
  timeInBedMinutes?: number;
  asleepMinutes?: number;
  efficiency?: number;
  latencyMinutes?: number;
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  awakeMinutes?: number;
  awakenings?: number;
  source: string;
  origin?: ObservationOrigin;
  externalId?: string;
  confidence: ObservationConfidenceLevel;
  notes?: string;
}

export interface RecoveryIndicator {
  id: string;
  userId: string;
  date: CalendarDate;
  hrvMs?: number;
  restingHeartRateBpm?: number;
  sleepScore?: number;
  readinessScore?: number;
  muscleSoreness?: number;
  fatigue?: number;
  sleepQuality?: number;
  readinessSubjective?: number;
  source: string;
  origin?: ObservationOrigin;
  externalId?: string;
  confidence: ObservationConfidenceLevel;
  notes?: string;
  createdAt: string;
}

export interface NewRecoveryIndicator {
  date?: CalendarDate;
  hrvMs?: number;
  restingHeartRateBpm?: number;
  sleepScore?: number;
  readinessScore?: number;
  muscleSoreness?: number;
  fatigue?: number;
  sleepQuality?: number;
  readinessSubjective?: number;
  source: string;
  origin?: ObservationOrigin;
  externalId?: string;
  confidence: ConfidenceLevel;
  notes?: string;
}

export type SleepAdequacy = "adequate" | "moderate_debt" | "severe_debt";
export type HrvTrend = "improving" | "stable" | "declining" | "unknown";
export type SleepTrend = "improving" | "stable" | "declining" | "unknown";
export type FatigueLevel = "low" | "moderate" | "high" | "very_high";
export type TrainingRecommendation = "maintain" | "active_recovery" | "reduce_volume" | "delay";

export interface RecoveryState {
  readinessScore: number;
  confidence: number;
  sleepQualityTrend: SleepTrend;
  sleepAdequacy: SleepAdequacy;
  hrvTrend: HrvTrend;
  fatigueAccumulation: FatigueLevel;
  limitingFactors: readonly string[];
  trainingRecommendation: TrainingRecommendation;
  nutritionRecommendations: readonly string[];
  activityRecommendations: readonly string[];
  basisNote: string;
}

export interface RecoveryPlateauSignal {
  kind: string;
  observation: string;
  affectedEntity: string;
  severity: number;
  observedWeeks: number;
}

// --- Unified Decision Brain (Phase 8) ----------------------------------------------

export type UnifiedStateSourceKind =
  | "training_state"
  | "nutrition_state"
  | "body_state"
  | "recovery_state"
  | "activity_state"
  | "projection_state"
  | "goal_state";

export type ConfidenceLevel = "measured" | "label_declared" | "estimated" | "unknown";

export type UnifiedSeverity = "informational" | "watch" | "act" | "urgent";

export type UnifiedDiagnosisStatus = "open" | "monitoring" | "resolved" | "dismissed";

export interface DecisionEvidence {
  id: string;
  userId: string;
  kind: string;
  code: string;
  description: string;
  engine: UnifiedStateSourceKind;
  engineConfigVersion: string;
  generatedAt: string;
  payload: Record<string, unknown>;
  confidence: ConfidenceLevel;
  provenance: string;
  sensitive: boolean;
  relatedEntityIds: readonly string[];
  basis: string;
}

export interface UnifiedDiagnosis {
  id: string;
  userId: string;
  code: string;
  title: string;
  summary: string;
  severity: UnifiedSeverity;
  evidence: readonly DecisionEvidence[];
  contributingFactors: readonly string[];
  ruledOut: readonly string[];
  sourceEngines: readonly UnifiedStateSourceKind[];
  status: UnifiedDiagnosisStatus;
  unifiedStateId: string;
  openedAt: string;
  updatedAt: string;
  reviewOn?: CalendarDate;
}

export type InterventionPrecedence =
  | "critical_safety"
  | "recovery_blocking"
  | "nutrition_foundation"
  | "training_progression"
  | "body_composition"
  | "activity_alignment"
  | "maintenance"
  | "optimization";

export interface SpecialistValidation {
  engine: UnifiedStateSourceKind;
  valid: boolean;
  warnings: readonly string[];
  conflicts: readonly string[];
  requiredAdjustments: readonly string[];
  confidence: ConfidenceLevel;
}

export interface ValidatedInterventionCandidate {
  kind: string;
  parameters: Record<string, number | string | boolean | null>;
  rationale: string;
  expectedEffect: string;
  precedence: InterventionPrecedence;
  addressesDiagnoses: readonly string[];
  validations: readonly SpecialistValidation[];
  isValid: boolean;
  confidence: ConfidenceLevel;
  reviewOn?: CalendarDate;
}

export interface UnifiedStateSlice {
  sourceKind: UnifiedStateSourceKind;
  configVersion: string;
  computedAt: string;
  payload: unknown;
  confidence: ConfidenceLevel;
  warnings: readonly string[];
}

export interface UnifiedFitCoachState {
  id: string;
  userId: string;
  generatedAt: CalendarDate;
  configVersion: string;
  slices: readonly UnifiedStateSlice[];
  activeGoal?: Goal;
  activeInterventions: readonly string[];
  supersedesId?: string;
  summary: string;
  warnings: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionAssumption {
  code: string;
  description: string;
  category: string;
  value: string;
  sensitive: boolean;
  source: string;
}

export type DecisionKind =
  | "no_change"
  | "intervention_selected"
  | "plan_adaptation"
  | "measurement_protocol_change"
  | "goal_adjustment"
  | "environment_adaptation"
  | "custom";

export type DecisionSnapshotStatus = "current" | "superseded" | "archived";

export interface DecisionIntervention {
  interventionId?: string;
  kind: string;
  parameters: Record<string, number | string | boolean | null>;
  rationale: string;
  expectedEffect: string;
  addressesDiagnoses: readonly string[];
  reviewOn?: CalendarDate;
}

export interface DecisionSnapshot {
  id: string;
  userId: string;
  decidedAt: CalendarDate;
  kind: DecisionKind;
  status: DecisionSnapshotStatus;
  unifiedStateId: string;
  diagnosesAddressed: readonly string[];
  interventions: readonly DecisionIntervention[];
  assumptions: readonly DecisionAssumption[];
  evidence: readonly DecisionEvidence[];
  monitoringPlan: readonly string[];
  configVersion: string;
  summary: string;
  confidence: ConfidenceLevel;
  supersedesId?: string;
  warnings: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateDecisionResult {
  snapshot: DecisionSnapshot;
  isNew: boolean;
  previousSnapshot?: DecisionSnapshot;
  unifiedState: UnifiedFitCoachState;
  diagnoses: readonly UnifiedDiagnosis[];
  interventions: readonly ValidatedInterventionCandidate[];
}

export type DecisionOutcomeVerdict =
  | "improved_as_expected"
  | "partially_improved"
  | "no_effect"
  | "worsened"
  | "uncertain"
  | "too_early";

export interface DecisionOutcome {
  verdict: DecisionOutcomeVerdict;
  interventionVerdicts: readonly {
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: readonly string[];
  }[];
  observations: readonly string[];
  explanation: string;
  followUpDiagnosisIds: readonly string[];
  triggersReevaluation: boolean;
}

export interface ReevaluateDecisionResult {
  shouldReevaluate: boolean;
  reason: string;
}

export interface UnifiedStateResponse {
  unifiedState: UnifiedFitCoachState;
}

export interface GenerateDecisionRequest {
  asOf?: CalendarDate;
  forceReevaluate?: boolean;
  assumptionOverrides?: Record<string, string>;
}

export interface RecordDecisionOutcomeRequest {
  evaluationWindow: string;
  verdict: DecisionOutcomeVerdict;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds?: string[];
  triggersReevaluation: boolean;
  evaluatedAt?: string;
  interventionVerdicts: readonly {
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: string[];
  }[];
}

// --- AI Coach (Phase 9.3) -----------------------------------------------------

export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  isMock: boolean;
  provider?: string;
  model?: string;
  createdAt: string;
  contextSnapshot?: unknown;
  evidenceRefs?: unknown;
  proposedActions?: unknown;
}

export interface EvidenceReference {
  source: string;
  code: string;
  title: string;
  value: string;
  expected?: string;
  confidence: ConfidenceLevel;
  provenance: string;
  generatedAt: string;
  relatedEntityIds: readonly string[];
  basis: string;
  decisionSnapshotId?: string;
  diagnosisId?: string;
}

export interface ContextSourceSnapshot {
  source: string;
  label: string;
  lastObservedAt?: string;
  stalenessDays: number;
  isStale: boolean;
  completenessPercent: number;
  confidence: ConfidenceLevel;
  missingFields: readonly string[];
  warnings: readonly string[];
}

export interface ContextQuality {
  overallScore: number;
  sources: readonly ContextSourceSnapshot[];
  missingDataWarnings: readonly string[];
  staleDataWarnings: readonly string[];
  recommendedFollowUpQuestions: readonly string[];
  sufficientForAdvice: boolean;
}

export interface CoachingDecisionSnapshot {
  id: string;
  kind: string;
  status: string;
  decidedAt: CalendarDate;
  summary: string;
  confidence: ConfidenceLevel;
}

export interface CoachingDecisionContext {
  decisionSnapshot: CoachingDecisionSnapshot | null;
  diagnoses: readonly { id: string; code: string; title: string; severity: string; status: string }[];
  activeInterventions: readonly string[];
  outcomes: readonly { id: string; verdict: string; evaluationWindow: string; triggersReevaluation: boolean; evaluatedAt: string }[];
  shouldReevaluate: { should: boolean; reason: string } | null;
  evidenceRefs: readonly EvidenceReference[];
  assumptions: readonly { code: string; description: string; category: string; value: string; sensitive: boolean; source: string }[];
}

export interface ProposedAction {
  id: string;
  kind: string;
  title: string;
  description: string;
  domainService: string;
  parameters: Record<string, string | number | boolean | null>;
  requiresConfirmation: boolean;
  validated: boolean;
  evidenceRefs: readonly EvidenceReference[];
  decisionSnapshotId?: string;
  status: "pending" | "confirmed" | "rejected" | "executed";
}

export interface PersonalContextSnapshot {
  userId: string;
  asOf: CalendarDate;
  generatedAt: string;
  sources: readonly ContextSourceSnapshot[];
  quality: ContextQuality;
  profile?: { userId: string; timezone: string; profile?: unknown };
  goal?: unknown;
  training?: unknown;
  nutrition?: unknown;
  activity?: unknown;
  recovery?: unknown;
  body?: unknown;
  projection?: unknown;
  decision?: CoachingDecisionContext;
  conversation?: unknown;
}

export interface CoachingResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  intent: { intent: string; confidence: number; entities: Record<string, string | number | boolean | null> };
  contextSnapshot: PersonalContextSnapshot;
  evidenceReferences: readonly EvidenceReference[];
  decisionContext: CoachingDecisionContext;
  quality: ContextQuality;
  proposedActions: readonly ProposedAction[];
  warnings: readonly string[];
  isMock: boolean;
}
