import { api, type ApiResult } from "./index";
import type {
  ActivityContext,
  ActivityRecord,
  ActivityTargets,
  BodyMeasurement,
  BarcodeLookupResponse,
  CalendarDate,
  CoachingResponse,
  Conversation,
  ConversationMessage,
  ContinuitySummary,
  DailyActivitySummary,
  DecisionOutcome,
  DecisionSnapshot,
  DecisionSnapshotStatus,
  EnvironmentLimitation,
  EquipmentItem,
  ExerciseDetail,
  ExerciseSet,
  ExerciseSummary,
  ExerciseUniverseEntry,
  GenerateDecisionRequest,
  GeneratePlanResult,
  Goal,
  GoalKind,
  LedgerEntry,
  LoadKind,
  NewActivityRecord,
  NewBodyMeasurement,
  NewRecoveryIndicator,
  NewSleepObservation,
  NutritionAssessmentForProduct,
  PerformanceObservation,
  Profile,
  ProgressionEvaluationResult,
  ReevaluateDecisionResult,
  RecoveryIndicator,
  RecoveryPlateauSignal,
  RecoveryState,
  RecordDecisionOutcomeRequest,
  SearchFoodsParams,
  SearchFoodsResponse,
  SessionClassification,
  SleepObservation,
  TemporaryPlanResult,
  TrainingEnvironment,
  TrainingEnvironmentKind,
  TrainingPlan,
  TrainingState,
  UnifiedFitCoachState,
  UnifiedStateResponse,
  User,
  UserEquipment,
  Workout,
  WorkoutAggregate,
  WorkoutListEntry,
  WorkoutExercise,
} from "./types";

/**
 * FitCoach API endpoints, grouped by product area. Thin wrappers only.
 */

// --- Identity / profile ----------------------------------------------------

export const createUser = (input: { email: string; displayName: string; timezone: string }) =>
  api.post<{ user: User }>("/v0/users", input);

export const getUser = (userId: string) => api.get<{ user: User }>(`/v0/users/${userId}`);

export const getProfile = (userId: string) =>
  api.get<{ profile: Profile }>(`/v0/users/${userId}/profile`);

export const putProfile = (userId: string, profile: Profile & { revisionReason?: string }) =>
  api.put<{ profile: Profile }>(`/v0/users/${userId}/profile`, profile);

// --- Body measurements -------------------------------------------------------

/**
 * The API records a measurement occasion, not a single scalar: post whichever
 * of bodyWeightKg / bodyFatPercent / circumferencesCm you have (at least one).
 */
export const recordMeasurement = (userId: string, input: NewBodyMeasurement) =>
  api.post<{ measurement: BodyMeasurement }>(`/v0/users/${userId}/measurements`, input);

// --- Goals -----------------------------------------------------------------

export const createGoal = (
  userId: string,
  input: { kind: GoalKind; description?: string; effectiveFrom: CalendarDate; priorities?: string[] },
) => api.post<{ goal: Goal }>(`/v0/users/${userId}/goals`, input);

export const getActiveGoal = (userId: string) =>
  api.get<{ goal: Goal | null }>(`/v0/users/${userId}/goals/active`);

// --- Equipment --------------------------------------------------------------

export const getEquipmentCatalog = () => api.get<{ equipment: EquipmentItem[] }>("/v0/equipment");

export const getUserEquipment = (userId: string) =>
  api.get<{ equipment: UserEquipment[] }>(`/v0/users/${userId}/equipment`);

export const addUserEquipment = (userId: string, equipmentId: string, validFrom: CalendarDate) =>
  api.post(`/v0/users/${userId}/equipment`, { equipmentId, validFrom });

// --- Knowledge / exercises ---------------------------------------------------

export const listExercises = () => api.get<{ exercises: ExerciseSummary[] }>("/v0/exercises");

export const getExerciseDetail = (exerciseId: string) =>
  api.get<ExerciseDetail>(`/v0/exercises/${exerciseId}`);

export const getExerciseUniverse = (userId: string) =>
  api.get<{ universe: ExerciseUniverseEntry[] }>(`/v0/users/${userId}/exercise-universe`);

// --- Training plans -----------------------------------------------------------

export const generatePlan = (
  userId: string,
  input: {
    asOf: CalendarDate;
    goalKind?: GoalKind;
    availableTrainingDays?: number;
    maxSessionDurationMinutes?: number;
    experience?: string;
    priorities?: string[];
  },
) => api.post<GeneratePlanResult>(`/v0/users/${userId}/training-plans/generate`, input);

export const getActivePlan = (userId: string) =>
  api.get<{ plan: TrainingPlan | null }>(`/v0/users/${userId}/training-plans/active`);

export const getPlanConstraints = (userId: string, planId: string) =>
  api.get<{ constraints: { constraintKey: string; result: string; label: string; warningDetail?: string; violationDetail?: string }[] }>(
    `/v0/users/${userId}/training-plans/${planId}/constraints`,
  );

export const getPlanDecisions = (userId: string, planId: string) =>
  api.get<{
    decisions: {
      id: string;
      outcome: string;
      rationale: string;
      smallestUsefulChangeJustification?: string;
      createdAt: string;
    }[];
  }>(`/v0/users/${userId}/training-plans/${planId}/decisions`);

export const adaptPlan = (userId: string, planId: string) =>
  api.post<{
    outcome: string;
    rationale: string;
    smallestUsefulChangeJustification: string;
    newVersion?: { id: string; versionNumber: number };
  }>(`/v0/users/${userId}/training-plans/${planId}/adapt`, {});

export const getTrainingState = (userId: string) =>
  api.get<{ trainingState: TrainingState }>(`/v0/users/${userId}/training-state`);

export const generateTemporaryPlan = (
  userId: string,
  input: {
    asOf: CalendarDate;
    availableTrainingDays?: number;
    maxSessionDurationMinutes?: number;
    experience?: string;
  },
) => api.post<TemporaryPlanResult>(`/v0/users/${userId}/training-plans/generate-temporary`, input);

// --- Environments / continuity -------------------------------------------------

export const setEnvironment = (
  userId: string,
  input: {
    kind: TrainingEnvironmentKind;
    effectiveFrom: CalendarDate;
    reason?: string;
    isTemporary?: boolean;
    availableEquipmentIds?: readonly string[];
    unavailableEquipmentIds?: readonly string[];
  },
) => api.post<{ period: { id: string }; replayed: boolean }>(`/v0/users/${userId}/training-environments`, input);

export const getActiveEnvironment = (userId: string, asOf?: CalendarDate) =>
  api.get<{ environment: TrainingEnvironment }>(
    `/v0/users/${userId}/training-environments/active${asOf ? `?asOf=${asOf}` : ""}`,
  );

export const restoreEnvironment = (userId: string, asOf: CalendarDate) =>
  api.post<{ restored: boolean; environment: TrainingEnvironment; retiredPlanIds: string[] }>(
    `/v0/users/${userId}/training-environments/restore`,
    { asOf },
  );

export const getContinuity = (userId: string, asOf?: CalendarDate) =>
  api.get<ContinuitySummary>(
    `/v0/users/${userId}/training-continuity${asOf ? `?asOf=${asOf}` : ""}`,
  );

// --- Workouts -------------------------------------------------------------------

export const createWorkout = (
  userId: string,
  input: {
    planId?: string;
    startedAt: string;
    status: "in_progress";
    clientRequestId: string;
    environmentKind?: TrainingEnvironmentKind;
    sessionClassification?: SessionClassification;
  },
) => api.post<{ workout: Workout }>(`/v0/users/${userId}/workouts`, input);

export const addWorkoutExercise = (userId: string, workoutId: string, exerciseId: string) =>
  api.post<{ workoutExercise: WorkoutExercise }>(`/v0/users/${userId}/workouts/${workoutId}/exercises`, {
    exerciseId,
  });

export const addSet = (
  userId: string,
  workoutId: string,
  input: {
    workoutExerciseId: string;
    kind: string;
    loadKind?: LoadKind;
    loadKg?: number;
    addedLoadKg?: number;
    assistanceLoadKg?: number;
    reps?: number;
    rir?: number;
    clientRequestId: string;
  },
) => api.post<{ set: ExerciseSet }>(`/v0/users/${userId}/workouts/${workoutId}/sets`, input);

export const completeWorkout = (userId: string, workoutId: string, endedAt: string) =>
  api.post<{ workout: Workout }>(`/v0/users/${userId}/workouts/${workoutId}/complete`, {
    status: "completed",
    endedAt,
  });

export const getWorkout = (userId: string, workoutId: string) =>
  api.get<{ workout: WorkoutAggregate }>(`/v0/users/${userId}/workouts/${workoutId}`);

export const listWorkouts = (userId: string, limit = 20) =>
  api.get<{ workouts: WorkoutListEntry[] }>(`/v0/users/${userId}/workouts?limit=${limit}`);

// --- Performance / progression -----------------------------------------------------

export const getPerformanceHistory = (userId: string, exerciseId: string, limit = 50) =>
  api.get<{ observations: PerformanceObservation[] }>(
    `/v0/users/${userId}/performance-history?exerciseId=${exerciseId}&limit=${limit}`,
  );

export const evaluateProgression = (userId: string, exerciseId: string, asOf: CalendarDate) =>
  api.post<ProgressionEvaluationResult>(`/v0/users/${userId}/progression/evaluate`, {
    exerciseId,
    asOf,
  });

export const getLedger = (userId: string) =>
  api.get<{ entries: LedgerEntry[]; totalCompletedProgressions: number }>(
    `/v0/users/${userId}/progression/ledger`,
  );

// --- Nutrition / Food Search ----------------------------------------------------

export const searchFoods = (params: SearchFoodsParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.q);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));
  if (params.sourceId) searchParams.set("sourceId", params.sourceId);
  return api.get<SearchFoodsResponse>(`/v0/foods/search?${searchParams.toString()}`);
};

// --- Barcode Scanner -----------------------------------------------------------

export const lookupBarcode = (barcode: string): ApiResult<BarcodeLookupResponse> =>
  api.get<BarcodeLookupResponse>(`/v0/barcode/lookup?barcode=${encodeURIComponent(barcode)}`);

export const getProductPreview = (barcode: string, servingGrams: number): ApiResult<NutritionAssessmentForProduct> =>
  api.get<NutritionAssessmentForProduct>(`/v0/barcode/preview?barcode=${encodeURIComponent(barcode)}&servingGrams=${servingGrams}`);

// --- Activity ---------------------------------------------------------------------

export const recordActivity = (userId: string, input: NewActivityRecord) =>
  api.post<{ activity: ActivityRecord }>(`/v0/users/${userId}/activity`, input);

export const listActivity = (userId: string, params?: { kind?: string; limit?: number; from?: CalendarDate; to?: CalendarDate }) => {
  const searchParams = new URLSearchParams();
  if (params?.kind) searchParams.set("kind", params.kind);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  return api.get<{ activity: ActivityRecord[] }>(`/v0/users/${userId}/activity?${searchParams.toString()}`);
};

// --- Sleep --------------------------------------------------------------------------

export const recordSleep = (userId: string, input: NewSleepObservation) =>
  api.post<{ sleep: SleepObservation }>(`/v0/users/${userId}/sleep`, input);

export const listSleep = (userId: string, params?: { limit?: number; from?: CalendarDate; to?: CalendarDate; origin?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  if (params?.origin) searchParams.set("origin", params.origin);
  return api.get<{ sleep: SleepObservation[] }>(`/v0/users/${userId}/sleep?${searchParams.toString()}`);
};

// --- Recovery Indicators ------------------------------------------------------------

export const recordRecoveryIndicator = (userId: string, input: NewRecoveryIndicator) =>
  api.post<{ indicator: RecoveryIndicator }>(`/v0/users/${userId}/recovery/indicators`, input);

export const listRecoveryIndicators = (userId: string, params?: { limit?: number; from?: CalendarDate; to?: CalendarDate; origin?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  if (params?.origin) searchParams.set("origin", params.origin);
  return api.get<{ indicators: RecoveryIndicator[] }>(`/v0/users/${userId}/recovery/indicators?${searchParams.toString()}`);
};

// --- Activity Intelligence (derived) ------------------------------------------------

export const getDailyActivitySummaries = (userId: string, from: CalendarDate, to: CalendarDate) =>
  api.get<{ dailySummaries: DailyActivitySummary[] }>(`/v0/users/${userId}/activity/daily?from=${from}&to=${to}`);

export const getActivityTargets = (userId: string) =>
  api.get<{ targets: ActivityTargets }>(`/v0/users/${userId}/activity/targets`);

export const getActivityContext = (userId: string, windowDays = 14) =>
  api.get<{ context: ActivityContext }>(`/v0/users/${userId}/activity/context?windowDays=${windowDays}`);

// --- Recovery Intelligence (derived) ------------------------------------------------

export const getRecoveryState = (userId: string) =>
  api.get<{ state: RecoveryState }>(`/v0/users/${userId}/recovery/state`);

export const getRecoveryPlateauSignals = (userId: string) =>
  api.get<{ signals: RecoveryPlateauSignal[]; windowDays: number }>(`/v0/users/${userId}/recovery/trends`);

// --- Unified Decision Brain (Phase 8) ------------------------------------------------

export const generateDecision = (userId: string, input: GenerateDecisionRequest = {}) =>
  api.post<{ decision: DecisionSnapshot; isNew: boolean; unifiedState: UnifiedFitCoachState }>(
    `/v0/users/${userId}/decisions`,
    input,
  );

export const getDecisions = (userId: string, params?: { status?: DecisionSnapshotStatus; limit?: number; cursor?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.cursor) searchParams.set("cursor", params.cursor);
  return api.get<{ decisions: DecisionSnapshot[] }>(`/v0/users/${userId}/decisions?${searchParams.toString()}`);
};

export const getCurrentDecision = (userId: string) =>
  api.get<{ decision: DecisionSnapshot | null }>(`/v0/users/${userId}/decisions/current`);

export const getDecision = (userId: string, decisionId: string) =>
  api.get<{ decision: DecisionSnapshot }>(`/v0/users/${userId}/decisions/${decisionId}`);

export const recordDecisionOutcome = (userId: string, decisionId: string, input: RecordDecisionOutcomeRequest) =>
  api.post<{ outcome: DecisionOutcome }>(`/v0/users/${userId}/decisions/${decisionId}/outcomes`, input);

export const listDecisionOutcomes = (userId: string, decisionId: string, params?: { evaluationWindow?: string; limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.evaluationWindow) searchParams.set("evaluationWindow", params.evaluationWindow);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  return api.get<{ outcomes: DecisionOutcome[] }>(`/v0/users/${userId}/decisions/${decisionId}/outcomes?${searchParams.toString()}`);
};

export const shouldReevaluateDecision = (userId: string, decisionId: string) =>
  api.get<ReevaluateDecisionResult>(`/v0/users/${userId}/decisions/${decisionId}/reevaluate`);

export const getUnifiedState = (userId: string, asOf?: CalendarDate) =>
  api.get<UnifiedStateResponse>(`/v0/users/${userId}/unified-state${asOf ? `?asOf=${asOf}` : ""}`);

// --- AI Coach (Phase 9.3) -----------------------------------------------------

export const createConversation = (userId: string, input?: { title?: string }) =>
  api.post<{ conversation: Conversation }>(`/v0/users/${userId}/conversations`, input ?? {});

export const listConversations = (userId: string, params?: { limit?: number; cursor?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.cursor) searchParams.set("cursor", params.cursor);
  return api.get<{ conversations: Conversation[] }>(`/v0/users/${userId}/conversations?${searchParams.toString()}`);
};

export const listMessages = (userId: string, conversationId: string, params?: { limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  return api.get<{ messages: ConversationMessage[] }>(`/v0/users/${userId}/conversations/${conversationId}/messages?${searchParams.toString()}`);
};

export const sendMessage = (
  userId: string,
  conversationId: string,
  input: { message: string; asOf?: CalendarDate },
) => api.post<CoachingResponse>(`/v0/users/${userId}/conversations/${conversationId}/messages`, input);

export const getMessage = (userId: string, messageId: string) =>
  api.get<{ message: ConversationMessage }>(`/v0/users/${userId}/messages/${messageId}`);

export const previewAction = (
  userId: string,
  conversationId: string,
  messageId: string,
  actionId: string,
) => api.post<{ action: ConversationMessage; preview: { kind: string; title: string; requiresConfirmation: boolean; validation: { valid: boolean; errors: string[] }; preview: string } }>(
  `/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/preview`,
  undefined,
);

export const confirmAction = (
  userId: string,
  conversationId: string,
  messageId: string,
  actionId: string,
) => api.post<{ status: string; result?: unknown; error?: string }>(
  `/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/confirm`,
  undefined,
);

export const rejectAction = (
  userId: string,
  conversationId: string,
  messageId: string,
  actionId: string,
) => api.post<{ status: string }>(
  `/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/reject`,
  undefined,
);

export type { EnvironmentLimitation };
