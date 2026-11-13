import type {
  ActivityRecord,
  BodyMeasurement,
  CalendarDate,
  ConfidenceLevel,
  DailyNutrition,
  Diagnosis,
  DiagnosisId,
  EntityId,
  Intervention,
  ProjectionDivergence,
  RecoveryState,
  TrainingState,
  UnifiedDiagnosis,
  UnifiedDiagnosisRequest,
  UnifiedDiagnosisResult,
  UnifiedFitCoachState,
  UnifiedSeverity,
  UnifiedStateSlice,
  UnifiedStateSourceKind,
  UserId,
  Workout,
  DecisionEvidence,
  DecisionEvidenceKind,
} from "@fitcoach/domain";

/**
 * Unified Diagnosis Engine (Phase 8)
 *
 * Runs deterministic cross-engine diagnosis over a Unified FitCoach State.
 * Produces UnifiedDiagnosis objects that may draw evidence from multiple specialists.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DiagnosisConfiguration {
  version: string;
  minTrendPoints: number;
  proteinDeficiencyThreshold: number;
  calorieAdherenceThreshold: number;
  weightTrendThresholdKgPerWeek: number;
  bodyFatTrendThresholdPercentPerWeek: number;
  strengthStagnationThresholdPercentPerWeek: number;
  volumeDeficitThreshold: number;
  recoveryReadinessThreshold: number;
  hrvDeclineThresholdPercent: number;
  projectionDivergenceThresholdPercent: number;
  minDiagnosisConfidence: ConfidenceLevel;
}

export const DEFAULT_DIAGNOSIS_CONFIGURATION: DiagnosisConfiguration = {
  version: "fitcoach.diagnosis.v1",
  minTrendPoints: 7,
  proteinDeficiencyThreshold: 0.8,
  calorieAdherenceThreshold: 0.9,
  weightTrendThresholdKgPerWeek: 0.25,
  bodyFatTrendThresholdPercentPerWeek: 0.15,
  strengthStagnationThresholdPercentPerWeek: 0.5,
  volumeDeficitThreshold: 0.8,
  recoveryReadinessThreshold: 60,
  hrvDeclineThresholdPercent: 10,
  projectionDivergenceThresholdPercent: 15,
  minDiagnosisConfidence: "estimated",
};

// ---------------------------------------------------------------------------
// Evidence Builders
// ---------------------------------------------------------------------------

function confidenceToRank(confidence: ConfidenceLevel): number {
  switch (confidence) {
    case "measured":
      return 4;
    case "label_declared":
      return 3;
    case "estimated":
      return 2;
    case "unknown":
      return 1;
  }
}

function confidenceMeetsThreshold(confidence: ConfidenceLevel, threshold: ConfidenceLevel): boolean {
  return confidenceToRank(confidence) >= confidenceToRank(threshold);
}

function buildEvidenceFromSlice(
  slice: UnifiedStateSlice,
  kind: DecisionEvidenceKind,
  code: string,
  description: string,
  payload: unknown,
  basis: string,
  sensitive: boolean = false,
  relatedEntityIds: readonly EntityId[] = [],
): DecisionEvidence {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID() as EntityId,
    userId: slice.payload && typeof slice.payload === "object" && "userId" in slice.payload
      ? (slice.payload as { userId: string }).userId
      : "",
    kind,
    code,
    description,
    engine: slice.sourceKind,
    engineConfigVersion: slice.configVersion,
    generatedAt: slice.computedAt,
    payload,
    confidence: slice.confidence,
    provenance: "inferred",
    sensitive,
    relatedEntityIds,
    basis,
    createdAt: now,
    updatedAt: now,
  };
}

function getSlice<K extends UnifiedStateSourceKind>(
  state: UnifiedFitCoachState,
  kind: K,
): UnifiedStateSlice | undefined {
  return state.slices.find((s) => s.sourceKind === kind);
}

// ---------------------------------------------------------------------------
// Specialist Evidence Extractors
// ---------------------------------------------------------------------------

function extractTrainingEvidence(
  state: UnifiedFitCoachState,
  config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "training_state");
  if (!slice) return evidence;

  const trainingState = slice.payload as TrainingState;

  if (trainingState.plateauSignals && trainingState.plateauSignals.length > 0) {
    for (const signal of trainingState.plateauSignals) {
      evidence.push(
        buildEvidenceFromSlice(
          slice,
          "plateau_signal",
          `training_${signal.kind}`,
          `Training: ${signal.observation}`,
          signal,
          `Training plateau signal: ${signal.kind} (severity: ${signal.severity ?? "unknown"})`,
          true,
          signal.affectedEntity ? [signal.affectedEntity as EntityId] : [],
        ),
      );
    }
  }

  if (trainingState.plannedWeeklyVolumePerMuscle && trainingState.completedWeeklyVolumePerMuscle) {
    for (const [muscle, planned] of Object.entries(trainingState.plannedWeeklyVolumePerMuscle)) {
      const completed = trainingState.completedWeeklyVolumePerMuscle[muscle] ?? 0;
      if (planned > 0 && completed / planned < config.volumeDeficitThreshold) {
        evidence.push(
          buildEvidenceFromSlice(
            slice,
            "trend",
            "training_volume_deficit",
            `Training volume for ${muscle} is ${Math.round((completed / planned) * 100)}% of target (${completed}/${planned} sets)`,
            { muscle, planned, completed, ratio: completed / planned },
            `Volume deficit detected for ${muscle}`,
            true,
            [muscle as EntityId],
          ),
        );
      }
    }
  }

  if (trainingState.adherence !== undefined && trainingState.adherence < config.calorieAdherenceThreshold) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "trend",
        "training_adherence_low",
        `Training adherence is ${Math.round(trainingState.adherence * 100)}%`,
        { adherence: trainingState.adherence },
        "Low training session adherence",
        false,
      ),
    );
  }

  if (trainingState.progressionStatus) {
    for (const [exerciseId, status] of Object.entries(trainingState.progressionStatus)) {
      if (status.status === "stalled" || status.status === "regressing") {
        const { exerciseId: _, ...restStatus } = status;
        evidence.push(
          buildEvidenceFromSlice(
            slice,
            "trend",
            "training_progression_stalled",
            `${status.exerciseName} progression is ${status.status}`,
            { exerciseId, ...restStatus } as Record<string, unknown>,
            `Progression status: ${status.status} for ${status.exerciseName}`,
            true,
            [exerciseId as EntityId],
          ),
        );
      }
    }
  }

  return evidence;
}

function extractNutritionEvidence(
  state: UnifiedFitCoachState,
  config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "nutrition_state");
  if (!slice) return evidence;

  const nutritionState = slice.payload as {
    dailyNutrition?: DailyNutrition[];
    targets?: { proteinG: number; caloriesKcal: number };
    adherence?: { proteinPercent: number; caloriesPercent: number };
    trends?: { proteinTrend: string; caloriesTrend: string };
  };

  if (nutritionState.adherence && nutritionState.adherence.proteinPercent < config.proteinDeficiencyThreshold * 100) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "nutrition_adherence",
        "protein_intake_below_target",
        `Protein intake is ${nutritionState.adherence.proteinPercent.toFixed(0)}% of target`,
        { adherence: nutritionState.adherence.proteinPercent, target: nutritionState.targets?.proteinG },
        `Protein adherence: ${nutritionState.adherence.proteinPercent.toFixed(0)}%`,
        true,
      ),
    );
  }

  if (nutritionState.adherence && nutritionState.adherence.caloriesPercent < config.calorieAdherenceThreshold * 100) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "nutrition_adherence",
        "calorie_intake_below_target",
        `Calorie intake is ${nutritionState.adherence.caloriesPercent.toFixed(0)}% of target`,
        { adherence: nutritionState.adherence.caloriesPercent, target: nutritionState.targets?.caloriesKcal },
        `Calorie adherence: ${nutritionState.adherence.caloriesPercent.toFixed(0)}%`,
        true,
      ),
    );
  }

  if (nutritionState.adherence && nutritionState.adherence.caloriesPercent > 115) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "nutrition_adherence",
        "calorie_intake_above_target",
        `Calorie intake is ${nutritionState.adherence.caloriesPercent.toFixed(0)}% of target (surplus)`,
        { adherence: nutritionState.adherence.caloriesPercent, target: nutritionState.targets?.caloriesKcal },
        `Calorie surplus: ${nutritionState.adherence.caloriesPercent.toFixed(0)}%`,
        false,
      ),
    );
  }

  return evidence;
}

function extractBodyEvidence(
  state: UnifiedFitCoachState,
  config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "body_state");
  if (!slice) return evidence;

  const bodyState = slice.payload as {
    weightTrend?: { slopeKgPerWeek: number; direction: string; confidence: ConfidenceLevel };
    bodyFatTrend?: { slopePercentPerWeek: number; direction: string; confidence: ConfidenceLevel };
    disproportionateDevelopment?: { muscle: string; severity: string; confidence: ConfidenceLevel }[];
    measurementTrends?: Record<string, { slopeCmPerWeek: number; direction: string; confidence: ConfidenceLevel }>;
  };

  if (bodyState.weightTrend && Math.abs(bodyState.weightTrend.slopeKgPerWeek) >= config.weightTrendThresholdKgPerWeek) {
    const direction = bodyState.weightTrend.slopeKgPerWeek > 0 ? "gaining" : "losing";
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "trend",
        `body_weight_${direction}`,
        `Body weight is ${direction} at ${Math.abs(bodyState.weightTrend.slopeKgPerWeek).toFixed(2)} kg/week`,
        bodyState.weightTrend,
        `Weight trend: ${direction} ${Math.abs(bodyState.weightTrend.slopeKgPerWeek).toFixed(2)} kg/week`,
        true,
      ),
    );
  }

  if (bodyState.bodyFatTrend && Math.abs(bodyState.bodyFatTrend.slopePercentPerWeek) >= config.bodyFatTrendThresholdPercentPerWeek) {
    const direction = bodyState.bodyFatTrend.slopePercentPerWeek > 0 ? "increasing" : "decreasing";
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "trend",
        `body_fat_${direction}`,
        `Body fat is ${direction} at ${Math.abs(bodyState.bodyFatTrend.slopePercentPerWeek).toFixed(2)}%/week`,
        bodyState.bodyFatTrend,
        `Body fat trend: ${direction} ${Math.abs(bodyState.bodyFatTrend.slopePercentPerWeek).toFixed(2)}%/week`,
        true,
      ),
    );
  }

  if (bodyState.disproportionateDevelopment) {
    for (const dev of bodyState.disproportionateDevelopment) {
      if (dev.severity === "high" || dev.severity === "moderate") {
        evidence.push(
          buildEvidenceFromSlice(
            slice,
            "disproportionate_development",
            `disproportionate_${dev.muscle}`,
            `${dev.muscle} shows ${dev.severity} disproportionate development`,
            dev,
            `Disproportionate development: ${dev.muscle} (${dev.severity})`,
            true,
            [dev.muscle as EntityId],
          ),
        );
      }
    }
  }

  return evidence;
}

function extractRecoveryEvidence(
  state: UnifiedFitCoachState,
  config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "recovery_state");
  if (!slice) return evidence;

  const recoveryState = slice.payload as RecoveryState;

  if (recoveryState.readinessScore < config.recoveryReadinessThreshold) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "recovery_state",
        "recovery_readiness_low",
        `Recovery readiness score is ${recoveryState.readinessScore}/100`,
        { readinessScore: recoveryState.readinessScore, factors: recoveryState.limitingFactors },
        `Low recovery readiness: ${recoveryState.readinessScore}/100`,
        true,
      ),
    );
  }

  if (recoveryState.hrvTrend === "declining") {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "recovery_state",
        "hrv_declining",
        "HRV is declining from baseline",
        { trend: recoveryState.hrvTrend },
        "HRV declining trend detected",
        true,
      ),
    );
  }

  if (recoveryState.sleepAdequacy === "severe_debt" || recoveryState.sleepAdequacy === "moderate_debt") {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "recovery_state",
        `sleep_${recoveryState.sleepAdequacy}`,
        `Sleep adequacy: ${recoveryState.sleepAdequacy}`,
        { sleepAdequacy: recoveryState.sleepAdequacy },
        `Sleep debt: ${recoveryState.sleepAdequacy}`,
        true,
      ),
    );
  }

  if (recoveryState.fatigueAccumulation === "high" || recoveryState.fatigueAccumulation === "very_high") {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "recovery_state",
        `fatigue_${recoveryState.fatigueAccumulation}`,
        `Fatigue accumulation: ${recoveryState.fatigueAccumulation}`,
        { fatigueAccumulation: recoveryState.fatigueAccumulation },
        `High training fatigue: ${recoveryState.fatigueAccumulation}`,
        true,
      ),
    );
  }

  return evidence;
}

function extractProjectionEvidence(
  state: UnifiedFitCoachState,
  config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "projection_state");
  if (!slice) return evidence;

  const projectionState = slice.payload as {
    currentSnapshot?: {
      id: string;
      metrics: { target: string; horizon: string; central: number; confidence: ConfidenceLevel }[];
      status: string;
    };
    divergences?: ProjectionDivergence[];
  };

  if (projectionState.divergences) {
    for (const divergence of projectionState.divergences) {
      if (divergence.significant && Math.abs(divergence.relativeDifferencePercent) >= config.projectionDivergenceThresholdPercent) {
        evidence.push(
          buildEvidenceFromSlice(
            slice,
            "projection_divergence",
            `projection_divergence_${divergence.target}`,
            `Projection divergence for ${divergence.target} (${divergence.horizon}): ${divergence.relativeDifferencePercent.toFixed(1)}% difference`,
            divergence,
            `Significant projection divergence: ${divergence.target} ${divergence.horizon}`,
            true,
            [divergence.projectionSnapshotId as EntityId],
          ),
        );
      }
    }
  }

  if (projectionState.currentSnapshot && projectionState.currentSnapshot.status === "diverged") {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "projection_divergence",
        "projection_superseded",
        "Current projection has been superseded due to divergence",
        { snapshotId: projectionState.currentSnapshot.id, status: projectionState.currentSnapshot.status },
        "Projection marked as diverged",
        false,
      ),
    );
  }

  return evidence;
}

function extractActivityEvidence(
  state: UnifiedFitCoachState,
  _config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "activity_state");
  if (!slice) return evidence;

  const activityState = slice.payload as {
    averageSteps?: number;
    dailyStepsTarget?: number;
    weeklyCardioMinutes?: number;
    weeklyCardioTarget?: number;
    adherence?: { stepsPercent: number; cardioPercent: number };
  };

  if (activityState.adherence && activityState.adherence.stepsPercent < 80) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "trend",
        "activity_steps_low",
        `Daily steps are ${activityState.adherence.stepsPercent.toFixed(0)}% of target`,
        { adherence: activityState.adherence.stepsPercent, target: activityState.dailyStepsTarget },
        `Low steps adherence: ${activityState.adherence.stepsPercent.toFixed(0)}%`,
        false,
      ),
    );
  }

  if (activityState.adherence && activityState.adherence.cardioPercent < 80) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "trend",
        "activity_cardio_low",
        `Weekly cardio is ${activityState.adherence.cardioPercent.toFixed(0)}% of target`,
        { adherence: activityState.adherence.cardioPercent, target: activityState.weeklyCardioTarget },
        `Low cardio adherence: ${activityState.adherence.cardioPercent.toFixed(0)}%`,
        false,
      ),
    );
  }

  return evidence;
}

function extractGoalEvidence(
  state: UnifiedFitCoachState,
  _config: DiagnosisConfiguration,
): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const slice = getSlice(state, "goal_state");
  if (!slice) return evidence;

  const goalState = slice.payload as {
    goal?: { kind: string; priorities: string[]; timeframeWeeks?: number };
    alignment?: { score: number; gaps: string[] };
  };

  if (goalState.alignment && goalState.alignment.score < 70) {
    evidence.push(
      buildEvidenceFromSlice(
        slice,
        "goal_alignment",
        "goal_alignment_low",
        `Goal alignment score is ${goalState.alignment.score}/100`,
        { score: goalState.alignment.score, gaps: goalState.alignment.gaps },
        `Low goal alignment: ${goalState.alignment.score}/100`,
        true,
        goalState.alignment.gaps.map((g) => g as EntityId),
      ),
    );
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Diagnosis Rule Engine
// ---------------------------------------------------------------------------

interface DiagnosisRule {
  code: string;
  title: string;
  severity: UnifiedSeverity;
  requiredEngines: UnifiedStateSourceKind[];
  triggerCodes: string[];
  minTriggers: number;
  buildSummary: (evidence: readonly DecisionEvidence[]) => string;
  contributingFactors: (evidence: readonly DecisionEvidence[]) => readonly string[];
  ruledOut: (evidence: readonly DecisionEvidence[]) => readonly string[];
}

const DIAGNOSIS_RULES: readonly DiagnosisRule[] = [
  {
    code: "protein_intake_below_target",
    title: "Protein Intake Below Target",
    severity: "act",
    requiredEngines: ["nutrition_state"],
    triggerCodes: ["protein_intake_below_target"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Protein intake data unavailable.";
      return `Protein intake is ${(e.payload as { adherence?: number }).adherence?.toFixed(0) ?? "unknown"}% of target.`;
    },
    contributingFactors: () => ["nutrition_adherence"],
    ruledOut: () => ["adequate_protein_intake"],
  },
  {
    code: "calorie_intake_below_target",
    title: "Calorie Intake Below Target",
    severity: "watch",
    requiredEngines: ["nutrition_state"],
    triggerCodes: ["calorie_intake_below_target"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Calorie intake data unavailable.";
      return `Calorie intake is ${(e.payload as { adherence?: number }).adherence?.toFixed(0) ?? "unknown"}% of target.`;
    },
    contributingFactors: () => ["nutrition_adherence"],
    ruledOut: () => ["adequate_calorie_intake"],
  },
  {
    code: "calorie_intake_above_target",
    title: "Calorie Intake Above Target",
    severity: "watch",
    requiredEngines: ["nutrition_state"],
    triggerCodes: ["calorie_intake_above_target"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Calorie intake data unavailable.";
      return `Calorie intake is ${(e.payload as { adherence?: number }).adherence?.toFixed(0) ?? "unknown"}% of target (surplus).`;
    },
    contributingFactors: () => ["nutrition_adherence"],
    ruledOut: () => ["calorie_deficit", "maintenance_calories"],
  },
  {
    code: "training_volume_deficit",
    title: "Training Volume Deficit",
    severity: "act",
    requiredEngines: ["training_state"],
    triggerCodes: ["training_volume_deficit"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const muscles = evidence.map((e) => (e.payload as { muscle?: string }).muscle).filter(Boolean);
      return `Training volume below target for: ${muscles.join(", ")}.`;
    },
    contributingFactors: () => ["training_volume", "adherence"],
    ruledOut: () => ["adequate_volume"],
  },
  {
    code: "training_adherence_low",
    title: "Low Training Adherence",
    severity: "watch",
    requiredEngines: ["training_state"],
    triggerCodes: ["training_adherence_low"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Training adherence data unavailable.";
      return `Training session adherence is ${Math.round((e.payload as { adherence?: number }).adherence ?? 0) * 100}%.`;
    },
    contributingFactors: () => ["schedule", "motivation", "recovery"],
    ruledOut: () => ["good_adherence"],
  },
  {
    code: "training_progression_stalled",
    title: "Training Progression Stalled",
    severity: "act",
    requiredEngines: ["training_state"],
    triggerCodes: ["training_progression_stalled"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const exercises = evidence.map((e) => (e.payload as { exerciseName?: string }).exerciseName).filter(Boolean);
      return `Progression stalled for: ${exercises.join(", ")}.`;
    },
    contributingFactors: () => ["progression", "volume", "recovery", "nutrition"],
    ruledOut: () => ["progressing_normally"],
  },
  {
    code: "body_weight_gaining_unintended",
    title: "Unintended Body Weight Gain",
    severity: "watch",
    requiredEngines: ["body_state"],
    triggerCodes: ["body_weight_gaining"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Body weight trend data unavailable.";
      return `Body weight gaining at ${Math.abs((e.payload as { slopeKgPerWeek?: number }).slopeKgPerWeek ?? 0).toFixed(2)} kg/week.`;
    },
    contributingFactors: () => ["calorie_surplus", "water_retention", "muscle_gain"],
    ruledOut: () => ["intentional_gain", "weight_stable", "weight_loss"],
  },
  {
    code: "body_weight_losing_unintended",
    title: "Unintended Body Weight Loss",
    severity: "watch",
    requiredEngines: ["body_state"],
    triggerCodes: ["body_weight_losing"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Body weight trend data unavailable.";
      return `Body weight losing at ${Math.abs((e.payload as { slopeKgPerWeek?: number }).slopeKgPerWeek ?? 0).toFixed(2)} kg/week.`;
    },
    contributingFactors: () => ["calorie_deficit", "illness", "overtraining"],
    ruledOut: () => ["intentional_loss", "weight_stable", "weight_gain"],
  },
  {
    code: "body_fat_increasing",
    title: "Body Fat Increasing",
    severity: "watch",
    requiredEngines: ["body_state"],
    triggerCodes: ["body_fat_increasing"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Body fat trend data unavailable.";
      return `Body fat increasing at ${Math.abs((e.payload as { slopePercentPerWeek?: number }).slopePercentPerWeek ?? 0).toFixed(2)}%/week.`;
    },
    contributingFactors: () => ["calorie_surplus", "insufficient_activity", "hormonal"],
    ruledOut: () => ["body_fat_stable", "body_fat_decreasing"],
  },
  {
    code: "disproportionate_development",
    title: "Disproportionate Muscle Development",
    severity: "watch",
    requiredEngines: ["body_state"],
    triggerCodes: ["disproportionate_"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const muscles = evidence.map((e) => (e.payload as { muscle?: string }).muscle).filter(Boolean);
      return `Disproportionate development detected: ${muscles.join(", ")}.`;
    },
    contributingFactors: () => ["volume_imbalance", "exercise_selection", "genetics"],
    ruledOut: () => ["balanced_development"],
  },
  {
    code: "recovery_readiness_low",
    title: "Low Recovery Readiness",
    severity: "act",
    requiredEngines: ["recovery_state"],
    triggerCodes: ["recovery_readiness_low"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Recovery readiness data unavailable.";
      return `Recovery readiness is ${(e.payload as { readinessScore?: number }).readinessScore ?? "unknown"}/100.`;
    },
    contributingFactors: () => ["sleep", "hrv", "training_load", "nutrition", "stress"],
    ruledOut: () => ["adequate_recovery"],
  },
  {
    code: "hrv_declining",
    title: "HRV Declining",
    severity: "watch",
    requiredEngines: ["recovery_state"],
    triggerCodes: ["hrv_declining"],
    minTriggers: 1,
    buildSummary: () => "Heart rate variability is declining from baseline.",
    contributingFactors: () => ["autonomic_stress", "overtraining", "illness", "sleep_debt"],
    ruledOut: () => ["hrv_stable", "hrv_improving"],
  },
  {
    code: "sleep_debt_severe",
    title: "Severe Sleep Debt",
    severity: "urgent",
    requiredEngines: ["recovery_state"],
    triggerCodes: ["sleep_severe_debt"],
    minTriggers: 1,
    buildSummary: () => "Severe sleep debt limiting recovery capacity.",
    contributingFactors: () => ["sleep_duration", "sleep_quality", "schedule"],
    ruledOut: () => ["adequate_sleep"],
  },
  {
    code: "fatigue_accumulation_high",
    title: "High Fatigue Accumulation",
    severity: "act",
    requiredEngines: ["recovery_state"],
    triggerCodes: ["fatigue_high", "fatigue_very_high"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Fatigue accumulation data unavailable.";
      return `Fatigue accumulation is ${(e.payload as { fatigueAccumulation?: string }).fatigueAccumulation ?? "high"}.`;
    },
    contributingFactors: () => ["training_volume", "insufficient_recovery", "nutrition", "sleep"],
    ruledOut: () => ["normal_fatigue", "low_fatigue"],
  },
  {
    code: "projection_divergence_significant",
    title: "Significant Projection Divergence",
    severity: "act",
    requiredEngines: ["projection_state"],
    triggerCodes: ["projection_divergence_"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const targets = evidence.map((e) => (e.payload as { target?: string }).target).filter(Boolean);
      return `Projections diverging from actuals for: ${targets.join(", ")}.`;
    },
    contributingFactors: () => ["adherence_change", "assumption_violation", "model_error"],
    ruledOut: () => ["projection_on_track"],
  },
  {
    code: "activity_steps_low",
    title: "Daily Steps Below Target",
    severity: "watch",
    requiredEngines: ["activity_state"],
    triggerCodes: ["activity_steps_low"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Activity steps data unavailable.";
      return `Daily steps at ${(e.payload as { adherence?: number }).adherence?.toFixed(0) ?? "unknown"}% of target.`;
    },
    contributingFactors: () => ["sedentary_job", "low_motivation", "injury", "schedule"],
    ruledOut: () => ["steps_on_target"],
  },
  {
    code: "activity_cardio_low",
    title: "Weekly Cardio Below Target",
    severity: "watch",
    requiredEngines: ["activity_state"],
    triggerCodes: ["activity_cardio_low"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Activity cardio data unavailable.";
      return `Weekly cardio at ${(e.payload as { adherence?: number }).adherence?.toFixed(0) ?? "unknown"}% of target.`;
    },
    contributingFactors: () => ["time_constraints", "preference", "recovery", "injury"],
    ruledOut: () => ["cardio_on_target"],
  },
  {
    code: "goal_alignment_low",
    title: "Low Goal Alignment",
    severity: "watch",
    requiredEngines: ["goal_state"],
    triggerCodes: ["goal_alignment_low"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const e = evidence[0];
      if (!e) return "Goal alignment data unavailable.";
      return `Goal alignment score is ${(e.payload as { score?: number }).score ?? "unknown"}/100. Gaps: ${(e.payload as { gaps?: string[] }).gaps?.join(", ") ?? "none"}.`;
    },
    contributingFactors: () => ["plan_design", "execution_gaps", "goal_conflicts"],
    ruledOut: () => ["goal_aligned"],
  },
  {
    code: "training_plateau_repeated_stagnation",
    title: "Repeated Performance Stagnation",
    severity: "act",
    requiredEngines: ["training_state"],
    triggerCodes: ["training_repeated_performance_stagnation"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const exercises = evidence.map((e) => (e.payload as { affectedEntity?: string }).affectedEntity).filter(Boolean);
      return `Repeated stagnation detected for: ${exercises.join(", ")}.`;
    },
    contributingFactors: () => ["progression_scheme", "volume", "recovery", "nutrition"],
    ruledOut: () => ["progressing"],
  },
  {
    code: "training_plateau_declining_performance",
    title: "Declining Performance",
    severity: "urgent",
    requiredEngines: ["training_state"],
    triggerCodes: ["training_declining_performance"],
    minTriggers: 1,
    buildSummary: (evidence) => {
      const exercises = evidence.map((e) => (e.payload as { affectedEntity?: string }).affectedEntity).filter(Boolean);
      return `Performance declining for: ${exercises.join(", ")}.`;
    },
    contributingFactors: () => ["overtraining", "under_recovery", "illness", "nutrition_deficit"],
    ruledOut: () => ["stable_performance", "improving_performance"],
  },
];

// ---------------------------------------------------------------------------
// Main Diagnosis Function
// ---------------------------------------------------------------------------

/**
 * Run unified diagnosis over a Unified FitCoach State.
 */
export function runUnifiedDiagnosis(
  request: UnifiedDiagnosisRequest,
  config: DiagnosisConfiguration = DEFAULT_DIAGNOSIS_CONFIGURATION,
): UnifiedDiagnosisResult {
  const { unifiedState, activeDiagnoses = [] } = request;

  const allEvidence: DecisionEvidence[] = [
    ...extractTrainingEvidence(unifiedState, config),
    ...extractNutritionEvidence(unifiedState, config),
    ...extractBodyEvidence(unifiedState, config),
    ...extractRecoveryEvidence(unifiedState, config),
    ...extractProjectionEvidence(unifiedState, config),
    ...extractActivityEvidence(unifiedState, config),
    ...extractGoalEvidence(unifiedState, config),
  ];

  const confidentEvidence = allEvidence.filter((e) =>
    confidenceMeetsThreshold(e.confidence, config.minDiagnosisConfidence),
  );

  const evidenceByCode = new Map<string, DecisionEvidence[]>();
  for (const evidence of confidentEvidence) {
    const code = evidence.code;
    const arr = evidenceByCode.get(code) ?? [];
    arr.push(evidence);
    evidenceByCode.set(code, arr);
  }

  const newDiagnoses: UnifiedDiagnosis[] = [];
  const now = new Date().toISOString();
  const today = now.split("T")[0] as CalendarDate;

  for (const rule of DIAGNOSIS_RULES) {
    const hasRequiredEngines = rule.requiredEngines.every((engine) =>
      unifiedState.slices.some((s) => s.sourceKind === engine),
    );
    if (!hasRequiredEngines) continue;

    const matchingEvidence: DecisionEvidence[] = [];
    for (const triggerCode of rule.triggerCodes) {
      if (triggerCode.endsWith("_")) {
        for (const [code, ev] of evidenceByCode.entries()) {
          if (code.startsWith(triggerCode)) {
            matchingEvidence.push(...ev);
          }
        }
      } else {
        const ev = evidenceByCode.get(triggerCode);
        if (ev) matchingEvidence.push(...ev);
      }
    }

    if (matchingEvidence.length >= rule.minTriggers) {
      const existingActive = activeDiagnoses.find((d) => d.code === rule.code);
      if (existingActive) {
        const updated: UnifiedDiagnosis = {
          ...existingActive,
          evidence: matchingEvidence,
          summary: rule.buildSummary(matchingEvidence),
          contributingFactors: rule.contributingFactors(matchingEvidence),
          ruledOut: rule.ruledOut(matchingEvidence),
          severity: rule.severity,
          sourceEngines: [...new Set(matchingEvidence.map((e) => e.engine))],
          unifiedStateId: unifiedState.id,
          updatedAt: now,
          status: "open",
        };
        newDiagnoses.push(updated);
      } else {
        const diagnosis: UnifiedDiagnosis = {
          id: crypto.randomUUID() as DiagnosisId,
          userId: unifiedState.userId,
          code: rule.code,
          title: rule.title,
          summary: rule.buildSummary(matchingEvidence),
          severity: rule.severity,
          evidence: matchingEvidence,
          contributingFactors: rule.contributingFactors(matchingEvidence),
          ruledOut: rule.ruledOut(matchingEvidence),
          sourceEngines: [...new Set(matchingEvidence.map((e) => e.engine))],
          status: "open",
          unifiedStateId: unifiedState.id,
          openedAt: now,
          updatedAt: now,
          createdAt: now,
          reviewOn: addDays(today, 14),
        };
        newDiagnoses.push(diagnosis);
      }
    }
  }

  const activeCodes = new Set(newDiagnoses.map((d) => d.code));
  const resolvedDiagnoses = activeDiagnoses.filter((d) => !activeCodes.has(d.code)).map((d) => ({
    ...d,
    status: "resolved" as const,
    updatedAt: now,
  }));

  const updatedDiagnoses = activeDiagnoses
    .filter((d) => activeCodes.has(d.code))
    .map((d) => {
      const updated = newDiagnoses.find((n) => n.code === d.code);
      return updated ?? { ...d, updatedAt: now };
    });

  const confidences = newDiagnoses.map((d) =>
    d.evidence.length > 0
      ? Math.max(...d.evidence.map((e) => confidenceToRank(e.confidence)))
      : 1,
  );
  const overallConfidenceRank = confidences.length > 0 ? Math.min(...confidences) : 1;
  const overallConfidence: ConfidenceLevel =
    overallConfidenceRank >= 4 ? "measured" : overallConfidenceRank >= 3 ? "label_declared" : "estimated";

  const warnings: string[] = [];
  const presentEngines = new Set(unifiedState.slices.map((s) => s.sourceKind));
  const expectedEngines: UnifiedStateSourceKind[] = [
    "training_state",
    "nutrition_state",
    "body_state",
    "recovery_state",
  ];
  for (const expected of expectedEngines) {
    if (!presentEngines.has(expected)) {
      warnings.push(`Missing specialist data: ${expected}`);
    }
  }
  if (unifiedState.warnings.length > 0) {
    warnings.push(...unifiedState.warnings);
  }

  return {
    newDiagnoses,
    updatedDiagnoses,
    resolvedDiagnoses,
    confidence: overallConfidence,
    warnings,
  };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0] as CalendarDate;
}

// ---------------------------------------------------------------------------
// Backward Compatibility
// ---------------------------------------------------------------------------

export interface DiagnosisDataSlice {
  workouts: readonly Workout[];
  bodyMeasurements: readonly BodyMeasurement[];
  activityRecords: readonly ActivityRecord[];
  dailyNutrition: readonly DailyNutrition[];
  activeInterventions: readonly Intervention[];
}

export interface DiagnosisRequest {
  userId: UserId;
  today: CalendarDate;
  analysisWindowDays: number;
  data: DiagnosisDataSlice;
}

/**
 * @deprecated Use runUnifiedDiagnosis with UnifiedFitCoachState instead.
 */
export function runDiagnoses(request: DiagnosisRequest): Diagnosis[] {
  const unifiedState = buildLegacyUnifiedState(request);
  const result = runUnifiedDiagnosis({
    userId: request.userId,
    unifiedState,
    analysisWindowDays: request.analysisWindowDays,
  });

  return [...result.newDiagnoses, ...result.updatedDiagnoses].map(convertToLegacyDiagnosis);
}

function buildLegacyUnifiedState(request: DiagnosisRequest): UnifiedFitCoachState {
  const now = new Date().toISOString();
  const today = request.today;

  const slices: UnifiedStateSlice[] = [
    {
      sourceKind: "training_state",
      configVersion: "fitcoach.training.v1",
      computedAt: now,
      payload: { plateauSignals: [], adherence: 1.0 },
      confidence: "estimated",
      warnings: ["Legacy unified state - limited training data"],
    },
    {
      sourceKind: "nutrition_state",
      configVersion: "fitcoach.nutrition.v1",
      computedAt: now,
      payload: { dailyNutrition: request.data.dailyNutrition, adherence: { proteinPercent: 100, caloriesPercent: 100 } },
      confidence: "estimated",
      warnings: ["Legacy unified state - limited nutrition analysis"],
    },
    {
      sourceKind: "body_state",
      configVersion: "fitcoach.body.v1",
      computedAt: now,
      payload: { bodyMeasurements: request.data.bodyMeasurements },
      confidence: "estimated",
      warnings: ["Legacy unified state - limited body analysis"],
    },
    {
      sourceKind: "activity_state",
      configVersion: "fitcoach.activity.v1",
      computedAt: now,
      payload: { activityRecords: request.data.activityRecords },
      confidence: "estimated",
      warnings: ["Legacy unified state - limited activity analysis"],
    },
    {
      sourceKind: "recovery_state",
      configVersion: "fitcoach.recovery.v1",
      computedAt: now,
      payload: {},
      confidence: "unknown",
      warnings: ["No recovery data in legacy request"],
    },
  ];

  return {
    id: crypto.randomUUID() as EntityId,
    userId: request.userId,
    generatedAt: today,
    configVersion: "fitcoach.diagnosis.v1",
    slices,
    activeInterventions: request.data.activeInterventions.map((i) => i.id),
    summary: "Legacy unified state for backward compatibility",
    warnings: ["Built from legacy DiagnosisRequest - limited cross-engine analysis"],
    createdAt: now,
    updatedAt: now,
  };
}

function convertToLegacyDiagnosis(unified: UnifiedDiagnosis): Diagnosis {
  return {
    id: unified.id,
    userId: unified.userId,
    code: unified.code,
    title: unified.title,
    summary: unified.summary,
    severity: unified.severity,
    evidence: unified.evidence.map((e) => ({
      metric: e.code,
      window: "analysis_window",
      observed: JSON.stringify(e.payload),
      expected: undefined,
    })),
    contributingFactors: unified.contributingFactors,
    ruledOut: unified.ruledOut,
    status: unified.status,
    createdAt: unified.createdAt,
    updatedAt: unified.updatedAt,
  };
}