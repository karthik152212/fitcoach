import type {
  CalendarDate,
  ConfidenceLevel,
  DecisionAssumption,
  DecisionEvidence,
  DecisionOutcomeVerdict,
  DecisionSnapshot,
  DecisionSnapshotId,
  DecisionSnapshotStatus,
  DecisionIntervention,
  DecisionKind,
  DiagnosisId,
  GenerateDecisionRequest,
  GenerateDecisionResult,
  InterventionSelectionContext,
  SelectInterventionsRequest,
  UnifiedDiagnosis,
  UnifiedDiagnosisRequest,
  UnifiedFitCoachState,
  UnifiedSeverity,
  UnifiedStateId,
  UnifiedStateSlice,
  UnifiedStateSourceKind,
  UserId,
  ValidatedInterventionCandidate,
  Goal,
} from "@fitcoach/domain";
import { runUnifiedDiagnosis, DEFAULT_DIAGNOSIS_CONFIGURATION, DiagnosisConfiguration } from "./diagnosis";
import { selectInterventions, DEFAULT_INTERVENTION_SELECTION_CONFIGURATION, InterventionSelectionConfiguration } from "./interventionSelection";

/**
 * Unified Decision Brain — Core Engine (Phase 8)
 *
 * Implements the complete decision lifecycle:
 * 1. Build Unified State → 2. Assess → 3. Diagnose → 4. Prioritize →
 * 5. Generate Interventions → 6. Validate → 7. Select → 8. Record → 9. Explain
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface UnifiedDecisionConfiguration {
  version: string;
  diagnosis: DiagnosisConfiguration;
  interventionSelection: InterventionSelectionConfiguration;
  minDecisionIntervalDays: number;
  allowNoChangeDecision: boolean;
  minDecisionConfidence: ConfidenceLevel;
}

export const DEFAULT_UNIFIED_DECISION_CONFIGURATION: UnifiedDecisionConfiguration = {
  version: "fitcoach.unified_decision.v1",
  diagnosis: DEFAULT_DIAGNOSIS_CONFIGURATION,
  interventionSelection: DEFAULT_INTERVENTION_SELECTION_CONFIGURATION,
  minDecisionIntervalDays: 7,
  allowNoChangeDecision: true,
  minDecisionConfidence: "estimated",
};

// ---------------------------------------------------------------------------
// Unified State Builder
// ---------------------------------------------------------------------------

export interface BuildUnifiedStateInput {
  userId: UserId;
  asOf: CalendarDate;
  slices: {
    trainingState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    nutritionState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    bodyState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    recoveryState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    activityState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    projectionState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
    goalState?: { payload: unknown; configVersion: string; confidence: ConfidenceLevel; warnings: string[] };
  };
  activeGoal?: unknown;
  activeInterventions: string[];
  previousUnifiedStateId?: UnifiedStateId;
}

/**
 * Build a Unified FitCoach State from specialist slices.
 */
export function buildUnifiedState(
  input: BuildUnifiedStateInput,
  configVersion: string = "fitcoach.unified_decision.v1",
): UnifiedFitCoachState {
  const now = new Date().toISOString();
  const today = input.asOf;

  const slices: UnifiedStateSlice[] = [];

  const sliceConfigs: Array<{ key: keyof BuildUnifiedStateInput["slices"]; kind: UnifiedStateSourceKind }> = [
    { key: "trainingState", kind: "training_state" },
    { key: "nutritionState", kind: "nutrition_state" },
    { key: "bodyState", kind: "body_state" },
    { key: "recoveryState", kind: "recovery_state" },
    { key: "activityState", kind: "activity_state" },
    { key: "projectionState", kind: "projection_state" },
    { key: "goalState", kind: "goal_state" },
  ];

  for (const { key, kind } of sliceConfigs) {
    const sliceData = input.slices[key];
    if (sliceData) {
      slices.push({
        sourceKind: kind,
        configVersion: sliceData.configVersion,
        computedAt: now,
        payload: sliceData.payload,
        confidence: sliceData.confidence,
        warnings: sliceData.warnings,
      });
    }
  }

  const allWarnings = slices.flatMap((s) => s.warnings);
  if (slices.length < 4) {
    allWarnings.push(`Only ${slices.length}/7 specialist slices available`);
  }

  const sliceNames = slices.map((s) => s.sourceKind).join(", ");
  const summary = `Unified state with ${slices.length} slices: ${sliceNames}`;

  return {
    id: crypto.randomUUID() as UnifiedStateId,
    userId: input.userId,
    generatedAt: today,
    configVersion,
    slices,
    activeGoal: input.activeGoal as Goal | undefined,
    activeInterventions: input.activeInterventions,
    supersedesId: input.previousUnifiedStateId,
    summary,
    warnings: allWarnings,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Decision Assumptions Builder
// ---------------------------------------------------------------------------

function buildDefaultAssumptions(unifiedState: UnifiedFitCoachState): DecisionAssumption[] {
  const assumptions: DecisionAssumption[] = [
    { code: "training_adherence_85_percent", description: "User will adhere to training plan at 85% or higher", category: "adherence", value: "0.85", sensitive: true, source: "configuration" },
    { code: "nutrition_adherence_90_percent", description: "User will adhere to nutrition targets at 90% or higher", category: "adherence", value: "0.90", sensitive: true, source: "configuration" },
    { code: "progression_rate_standard", description: "Standard progression rate assumed", category: "progression_rate", value: "standard", sensitive: true, source: "configuration" },
    { code: "recovery_adequate", description: "Recovery capacity assumed adequate", category: "recovery", value: "adequate", sensitive: true, source: "configuration" },
    { code: "measurement_consistency_weekly", description: "Body measurements taken weekly under consistent conditions", category: "measurement_consistency", value: "weekly_consistent", sensitive: false, source: "configuration" },
  ];

  const projectionSlice = unifiedState.slices.find((s) => s.sourceKind === "projection_state");
  if (projectionSlice) {
    const projAssumptions = (projectionSlice.payload as { assumptions?: { code: string; value: string }[] })?.assumptions;
    if (projAssumptions) {
      for (const pa of projAssumptions) {
        assumptions.push({
          code: `projection_${pa.code}`,
          description: `Projection assumption: ${pa.code}`,
          category: "progression_rate",
          value: pa.value,
          sensitive: true,
          source: "projection",
        });
      }
    }
  }

  return assumptions;
}

// ---------------------------------------------------------------------------
// Decision Builder
// ---------------------------------------------------------------------------

interface DecisionBuildContext {
  unifiedState: UnifiedFitCoachState;
  diagnoses: UnifiedDiagnosis[];
  interventions: ValidatedInterventionCandidate[];
  assumptions: DecisionAssumption[];
  evidence: DecisionEvidence[];
}

function buildDecisionSnapshot(
  context: DecisionBuildContext,
  config: UnifiedDecisionConfiguration,
  previousSnapshot?: DecisionSnapshot,
  decidedAt?: CalendarDate,
): DecisionSnapshot {
  const now = new Date().toISOString();
  // Use the requested asOf date as the decision date when provided, so that
  // shouldReevaluate day-interval math is anchored to the decision's anchor
  // date rather than the server's current clock.
  const today = decidedAt ?? now.split("T")[0] as CalendarDate;

  let kind: DecisionKind = "no_change";
  if (context.interventions.length > 0) {
    const hasTraining = context.interventions.some((i) => ["training_volume_adjustment", "exercise_substitution", "split_structure_adjustment", "progression_scheme_adjustment"].includes(i.kind));
    const hasNutrition = context.interventions.some((i) => ["nutrition_target_adjustment", "food_choice_guidance"].includes(i.kind));
    const hasRecovery = context.interventions.some((i) => i.kind === "recovery_adjustment");
    const hasActivity = context.interventions.some((i) => i.kind === "activity_target_adjustment");
    const hasBody = context.interventions.some((i) => i.kind === "measurement_protocol_adjustment");

    if (hasRecovery && (hasTraining || hasNutrition)) kind = "plan_adaptation";
    else if (hasTraining && hasNutrition) kind = "plan_adaptation";
    else if (hasRecovery) kind = "plan_adaptation";
    else if (hasTraining) kind = "plan_adaptation";
    else if (hasNutrition) kind = "intervention_selected";
    else if (hasActivity) kind = "intervention_selected";
    else if (hasBody) kind = "measurement_protocol_change";
    else kind = "intervention_selected";
  }

  const decisionInterventions: DecisionIntervention[] = context.interventions.map((c) => ({
    kind: c.kind,
    parameters: c.parameters,
    rationale: c.rationale,
    expectedEffect: c.expectedEffect,
    addressesDiagnoses: c.addressesDiagnoses,
    reviewOn: c.reviewOn,
  }));

  const monitoringPlan: string[] = [
    `Re-evaluate in ${config.diagnosis.minTrendPoints} days`,
    ...context.interventions.flatMap((i) => i.reviewOn ? [`Review ${i.kind} on ${i.reviewOn}`] : []),
  ];

  // A newly built snapshot is always "current". The previous snapshot is
  // marked "superseded" by the service/persistence layer, not here.
  let status: DecisionSnapshotStatus = "current";

  const diagnosisConfidences = context.diagnoses.map((d) => d.evidence.length > 0 ? Math.max(...d.evidence.map((e) => confidenceToRank(e.confidence))) : 1);
  const interventionConfidences = context.interventions.map((i) => confidenceToRank(i.confidence));
  const allConfidences = [...diagnosisConfidences, ...interventionConfidences];
  const overallConfidenceRank = allConfidences.length > 0 ? Math.min(...allConfidences) : 1;
  const confidenceMap: Record<number, ConfidenceLevel> = { 4: "measured", 3: "label_declared", 2: "estimated", 1: "unknown" };
  const overallConfidence = confidenceMap[overallConfidenceRank] ?? "estimated";

  const diagnosisCodes = context.diagnoses.map((d) => d.code).join(", ");
  const interventionKinds = context.interventions.map((i) => i.kind).join(", ");
  const summaryParts = [];
  if (context.diagnoses.length > 0) summaryParts.push(`Diagnoses: ${diagnosisCodes}`);
  if (context.interventions.length > 0) summaryParts.push(`Interventions: ${interventionKinds}`);
  if (summaryParts.length === 0) summaryParts.push("No changes recommended");
  const summary = summaryParts.join("; ");

  const warnings = [...context.unifiedState.warnings, ...context.diagnoses.flatMap((d) => d.evidence.map((e) => e.basis))].filter(Boolean);

  return {
    id: crypto.randomUUID() as DecisionSnapshotId,
    userId: context.unifiedState.userId,
    decidedAt: today,
    kind,
    status,
    unifiedStateId: context.unifiedState.id,
    diagnosesAddressed: context.diagnoses.map((d) => d.id),
    interventions: decisionInterventions,
    assumptions: context.assumptions,
    evidence: context.evidence,
    monitoringPlan,
    configVersion: config.version,
    summary,
    confidence: overallConfidence,
    supersedesId: previousSnapshot?.id,
    warnings,
    createdAt: now,
    updatedAt: now,
  };
}

function confidenceToRank(confidence: ConfidenceLevel): number {
  switch (confidence) { case "measured": return 4; case "label_declared": return 3; case "estimated": return 2; case "unknown": return 1; }
}

// ---------------------------------------------------------------------------
// Main Decision Engine
// ---------------------------------------------------------------------------

/**
 * Execute the complete unified decision lifecycle.
 */
export function makeUnifiedDecision(
  request: GenerateDecisionRequest,
  unifiedState: UnifiedFitCoachState,
  previousDecision?: DecisionSnapshot,
  config: UnifiedDecisionConfiguration = DEFAULT_UNIFIED_DECISION_CONFIGURATION,
): GenerateDecisionResult {
  const { userId } = request;

  const now = new Date().toISOString();
  const diagnosisRequest: UnifiedDiagnosisRequest = {
    userId,
    unifiedState,
    activeDiagnoses: previousDecision ? previousDecision.diagnosesAddressed.map((id) => ({ id: id as DiagnosisId, userId, code: "", title: "", summary: "", severity: "watch" as UnifiedSeverity, evidence: [], contributingFactors: [], ruledOut: [], sourceEngines: [], status: "open" as const, unifiedStateId: unifiedState.id, openedAt: now, updatedAt: now, createdAt: now })) : [],
    analysisWindowDays: 28,
  };

  const diagnosisResult = runUnifiedDiagnosis(diagnosisRequest, config.diagnosis);
  const allDiagnoses = [...diagnosisResult.newDiagnoses, ...diagnosisResult.updatedDiagnoses];

  const selectionContext: InterventionSelectionContext = {
    goal: unifiedState.activeGoal as any,
    activeInterventions: unifiedState.activeInterventions,
    hardConstraints: [],
    softConstraints: [],
  };

  const selectionRequest: SelectInterventionsRequest = { diagnoses: allDiagnoses, context: selectionContext, unifiedState, maxCandidates: config.interventionSelection.maxCandidates };
  const selectionResult = selectInterventions(selectionRequest, config.interventionSelection);

  const minConfidenceRank = confidenceToRank(config.minDecisionConfidence);
  const confidentInterventions = selectionResult.candidates.filter((c) => confidenceToRank(c.confidence) >= minConfidenceRank);

  const assumptions = buildDefaultAssumptions(unifiedState);
  const evidence = allDiagnoses.flatMap((d) => d.evidence);

  const decisionSnapshot = buildDecisionSnapshot({ unifiedState, diagnoses: allDiagnoses, interventions: confidentInterventions, assumptions, evidence }, config, previousDecision, request.asOf);

  const isNew = !previousDecision || previousDecision.status === "superseded" || previousDecision.id !== decisionSnapshot.id;

  return { snapshot: decisionSnapshot, isNew, previousSnapshot: previousDecision, unifiedState, diagnoses: allDiagnoses, interventions: confidentInterventions };
}

/**
 * Check if a re-evaluation is needed based on time and new data.
 */
export function shouldReevaluate(
  currentDecision: DecisionSnapshot,
  unifiedState: UnifiedFitCoachState,
  config: UnifiedDecisionConfiguration = DEFAULT_UNIFIED_DECISION_CONFIGURATION,
  recentOutcomes?: readonly { verdict: DecisionOutcomeVerdict; triggersReevaluation: boolean }[],
): { should: boolean; reason: string } {
  // A recent outcome that explicitly triggers reevaluation takes precedence
  // over the time interval. A worsened outcome is the strongest signal.
  // This is checked BEFORE daysSinceDecision so that a worsened outcome can
  // trigger reevaluation even when the normal time threshold has not elapsed.
  if (recentOutcomes && recentOutcomes.length > 0) {
    const triggers = recentOutcomes.filter((o) => o.triggersReevaluation);
    if (triggers.length > 0) {
      const worsened = triggers.some((o) => o.verdict === "worsened");
      if (worsened) {
        return { should: true, reason: "Recent outcome indicates worsened condition, triggering reevaluation" };
      }
      return { should: true, reason: "Recent outcome triggers reevaluation" };
    }
  }
  const daysSinceDecision = Math.floor((new Date(unifiedState.generatedAt + "T00:00:00").getTime() - new Date(currentDecision.decidedAt + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceDecision >= config.minDecisionIntervalDays) {
    return { should: true, reason: `${daysSinceDecision} days since last decision (threshold: ${config.minDecisionIntervalDays})` };
  }
  const projectionSlice = unifiedState.slices.find((s) => s.sourceKind === "projection_state");
  if (projectionSlice) {
    const divergences = (projectionSlice.payload as { divergences?: { significant: boolean }[] })?.divergences;
    if (divergences && divergences.some((d) => d.significant)) return { should: true, reason: "New significant projection divergences detected" };
  }
  const urgentDiagnoses = unifiedState.slices.flatMap((slice) => {
    if (slice.sourceKind === "training_state") {
      const trainingState = slice.payload as { plateauSignals?: { severity?: number }[] };
      return trainingState.plateauSignals?.filter((s) => (s.severity ?? 0) >= 0.8).length ?? 0;
    }
    return 0;
  });
  const urgentCount = urgentDiagnoses.reduce((sum, n) => sum + n, 0);
  if (urgentCount > 0) return { should: true, reason: `${urgentCount} urgent training signals detected` };
  return { should: false, reason: "No re-evaluation trigger" };
}

// ---------------------------------------------------------------------------
// Decision Outcome Evaluation
// ---------------------------------------------------------------------------

export interface DecisionOutcomeEvaluationInput {
  decisionSnapshot: DecisionSnapshot;
  currentUnifiedState: UnifiedFitCoachState;
  evaluationWindowDays: number;
  /** The verdict recorded by the user/coach, if any. Considered alongside measured evidence. */
  recordedVerdict?: "improved_as_expected" | "partially_improved" | "no_effect" | "worsened" | "uncertain" | "too_early";
}

export interface DecisionOutcomeEvaluationResult {
  verdict: "improved_as_expected" | "partially_improved" | "no_effect" | "worsened" | "uncertain" | "too_early";
  interventionVerdicts: Array<{ interventionIndex: number; verdict: "improved_as_expected" | "partially_improved" | "no_effect" | "worsened" | "uncertain" | "too_early"; observations: string[] }>;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds: DiagnosisId[];
  triggersReevaluation: boolean;
}

/**
 * Combine a recorded outcome verdict with evidence-based assessment.
 * Does not blindly follow the recorded verdict; weighs it against measured
 * evidence to avoid overreacting to a single noisy observation.
 */
function combineRecordedAndEvidenceVerdicts(
  recorded: DecisionOutcomeEvaluationResult["verdict"] | undefined,
  evidence: DecisionOutcomeEvaluationResult["verdict"],
): DecisionOutcomeEvaluationResult["verdict"] {
  if (!recorded) return evidence;
  if (recorded === evidence) return recorded;
  // Recorded worsened + evidence improved → uncertain (mixed signals, negative recorded)
  if (recorded === "worsened" && evidence === "improved_as_expected") return "uncertain";
  // Recorded improved + evidence worsened → recorded wins (positive user assessment)
  if (recorded === "improved_as_expected" && evidence === "worsened") return "improved_as_expected";
  // Recorded worsened + evidence no_effect → partially_improved (some signal but not clearly worse)
  if (recorded === "worsened" && evidence === "no_effect") return "partially_improved";
  // Recorded no_effect + evidence worsened → worsened (evidence takes priority)
  if (recorded === "no_effect" && evidence === "worsened") return "worsened";
  // Default: recorded verdict wins
  return recorded;
}

export function shouldTriggerReevaluation(verdict: DecisionOutcomeEvaluationResult["verdict"]): boolean {
  return verdict === "worsened" || verdict === "no_effect";
}

/**
 * Evaluate a decision's outcome against current state.
 */
export function evaluateDecisionOutcome(input: DecisionOutcomeEvaluationInput): DecisionOutcomeEvaluationResult {
  const { decisionSnapshot, currentUnifiedState, evaluationWindowDays, recordedVerdict } = input;
  if (evaluationWindowDays < 7) {
    return {
      verdict: "too_early",
      interventionVerdicts: decisionSnapshot.interventions.map((_, i) => ({ interventionIndex: i, verdict: "too_early", observations: [`Only ${evaluationWindowDays} days since decision`] })),
      observations: [`Evaluation window too short: ${evaluationWindowDays} days (minimum 7)`],
      explanation: "Insufficient time has passed to evaluate decision outcome",
      followUpDiagnosisIds: [],
      triggersReevaluation: false,
    };
  }
  const interventionVerdicts = decisionSnapshot.interventions.map((intervention, index) => {
    const addressedDiagnoses = intervention.addressesDiagnoses;
    let improved = 0, worsened = 0, unchanged = 0;
    const observations: string[] = [];
    for (const diagnosisId of addressedDiagnoses) {
      const currentSlice = currentUnifiedState.slices.find((s) => s.sourceKind === "training_state");
      if (currentSlice) {
        const trainingState = currentSlice.payload as { plateauSignals?: { kind: string }[] };
        const hasSignal = trainingState.plateauSignals?.some((s) => s.kind.includes("stagnation"));
        if (hasSignal) { worsened++; observations.push(`Training stagnation signal still present for ${diagnosisId}`); }
        else { improved++; observations.push(`Training signal resolved for ${diagnosisId}`); }
      } else { unchanged++; observations.push(`No current data for ${diagnosisId}`); }
    }
    let evidenceVerdict: DecisionOutcomeEvaluationResult["interventionVerdicts"][0]["verdict"] = "uncertain";
    if (improved > 0 && worsened === 0) evidenceVerdict = "improved_as_expected";
    else if (improved > 0 && worsened > 0) evidenceVerdict = "partially_improved";
    else if (worsened > 0) evidenceVerdict = "worsened";
    else if (unchanged === addressedDiagnoses.length) evidenceVerdict = "no_effect";
    const finalVerdict = combineRecordedAndEvidenceVerdicts(recordedVerdict, evidenceVerdict);
    return { interventionIndex: index, verdict: finalVerdict, observations };
  });
  const verdicts = interventionVerdicts.map((v) => v.verdict);
  let overallVerdict: DecisionOutcomeEvaluationResult["verdict"] = "uncertain";
  if (verdicts.every((v) => v === "improved_as_expected")) overallVerdict = "improved_as_expected";
  else if (verdicts.some((v) => v === "worsened")) overallVerdict = "worsened";
  else if (verdicts.some((v) => v === "partially_improved")) overallVerdict = "partially_improved";
  else if (verdicts.every((v) => v === "no_effect")) overallVerdict = "no_effect";
  const allObservations = interventionVerdicts.flatMap((v) => v.observations);
  const triggersReevaluation = shouldTriggerReevaluation(overallVerdict);
  return { verdict: overallVerdict, interventionVerdicts, observations: allObservations, explanation: `Decision evaluated after ${evaluationWindowDays} days. ${interventionVerdicts.length} intervention(s): ${verdicts.join(", ")}.`, followUpDiagnosisIds: [], triggersReevaluation };
}