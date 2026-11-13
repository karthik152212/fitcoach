import type {
  ConfidenceLevel,
  Diagnosis,
  Goal,
  Intervention,
  InterventionKind,
  InterventionParameters,
  UnifiedDiagnosis,
  UnifiedFitCoachState,
  UnifiedStateSourceKind,
  ValidatedInterventionCandidate,
  InterventionPrecedence,
  SpecialistValidation,
  InterventionSelectionContext,
  SelectInterventionsRequest,
  SelectInterventionsResult,
} from "@fitcoach/domain";

/**
 * Unified Intervention Selection Engine (Phase 8)
 *
 * Selects minimum effective interventions for diagnoses with cross-engine
 * specialist validation. Implements the "smallest useful change" principle.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface InterventionSelectionConfiguration {
  version: string;
  maxCandidates: number;
  kindPrecedence: Record<InterventionKind, InterventionPrecedence>;
  minCandidateConfidence: ConfidenceLevel;
  requireAllCriticalValidations: boolean;
  criticalEngines: UnifiedStateSourceKind[];
}

export const DEFAULT_INTERVENTION_SELECTION_CONFIGURATION: InterventionSelectionConfiguration = {
  version: "fitcoach.intervention_selection.v1",
  maxCandidates: 5,
  kindPrecedence: {
    nutrition_target_adjustment: "nutrition_foundation",
    food_choice_guidance: "nutrition_foundation",
    recovery_adjustment: "recovery_blocking",
    activity_target_adjustment: "activity_alignment",
    training_volume_adjustment: "training_progression",
    exercise_substitution: "training_progression",
    split_structure_adjustment: "training_progression",
    progression_scheme_adjustment: "training_progression",
    measurement_protocol_adjustment: "maintenance",
    no_change: "maintenance",
    custom: "optimization",
  },
  minCandidateConfidence: "estimated",
  requireAllCriticalValidations: true,
  criticalEngines: ["training_state", "nutrition_state", "recovery_state"],
};

// ---------------------------------------------------------------------------
// Intervention Generators
// ---------------------------------------------------------------------------

interface InterventionGenerator {
  handlesCodes: string[];
  generate(
    diagnosis: UnifiedDiagnosis,
    context: InterventionSelectionContext,
    unifiedState: UnifiedFitCoachState,
  ): ValidatedInterventionCandidate[];
}

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

/** Sanitize parameters to match Record<string, string | number | boolean | null> */
function sanitizeParams(params: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.filter(v => v !== undefined).join(", ");
    } else if (typeof value === "object" && value !== null) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value as string | number | boolean | null;
    }
  }
  return result;
}

const nutritionGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["protein_intake_below_target"],
    generate: (diagnosis, _context, _unifiedState) => {
      const evidence = diagnosis.evidence[0];
      if (!evidence) return [];
      const adherence = (evidence.payload as { adherence?: number }).adherence ?? 0;
      const gap = 100 - adherence;

      return [
        {
          kind: "nutrition_target_adjustment",
          parameters: sanitizeParams({
            target: "protein",
            adjustmentType: "increase",
            magnitudePercent: Math.min(gap * 1.2, 30),
            reason: "protein_deficiency",
          }),
          rationale: `Protein intake is ${adherence.toFixed(0)}% of target. Increase protein target to close the gap.`,
          expectedEffect: `Close protein gap of ${gap.toFixed(0)}% within 2 weeks`,
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
        {
          kind: "food_choice_guidance",
          parameters: sanitizeParams({
            focus: "high_protein_foods",
            mealTargets: { breakfast: 30, lunch: 40, dinner: 40, snacks: 20 },
            reason: "protein_deficiency",
          }),
          rationale: "Guide food choices toward higher protein density options across meals.",
          expectedEffect: "Increase protein intake by 15-25g/day through food selection",
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
  {
    handlesCodes: ["calorie_intake_below_target"],
    generate: (diagnosis, _context, _unifiedState) => {
      const evidence = diagnosis.evidence[0];
      if (!evidence) return [];
      const adherence = (evidence.payload as { adherence?: number }).adherence ?? 0;
      const gap = 100 - adherence;

      return [
        {
          kind: "nutrition_target_adjustment",
          parameters: sanitizeParams({
            target: "calories",
            adjustmentType: "increase",
            magnitudePercent: Math.min(gap * 1.1, 20),
            reason: "calorie_deficit",
          }),
          rationale: `Calorie intake is ${adherence.toFixed(0)}% of target. Increase calorie target to support recovery and performance.`,
          expectedEffect: `Close calorie gap of ${gap.toFixed(0)}% within 2 weeks`,
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
        {
          kind: "food_choice_guidance",
          parameters: sanitizeParams({
            focus: "calorie_dense_nutritious",
            mealTargets: { breakfast: 25, lunch: 35, dinner: 30, snacks: 10 },
            reason: "calorie_deficit",
          }),
          rationale: "Guide food choices toward more calorie-dense nutritious options.",
          expectedEffect: "Increase calorie intake by 200-400 kcal/day through food selection",
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
  {
    handlesCodes: ["calorie_intake_above_target"],
    generate: (diagnosis, _context, _unifiedState) => {
      const evidence = diagnosis.evidence[0];
      if (!evidence) return [];
      const adherence = (evidence.payload as { adherence?: number }).adherence ?? 0;
      const surplus = adherence - 100;

      return [
        {
          kind: "nutrition_target_adjustment",
          parameters: sanitizeParams({
            target: "calories",
            adjustmentType: "decrease",
            magnitudePercent: Math.min(surplus * 0.8, 15),
            reason: "calorie_surplus",
          }),
          rationale: `Calorie intake is ${adherence.toFixed(0)}% of target (surplus). Moderate reduction to align with goal.`,
          expectedEffect: `Reduce calorie surplus by ${Math.min(surplus, 15).toFixed(0)}% within 2 weeks`,
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
        {
          kind: "food_choice_guidance",
          parameters: sanitizeParams({
            focus: "satiety_high_volume",
            mealTargets: { breakfast: 30, lunch: 35, dinner: 25, snacks: 10 },
            reason: "calorie_surplus",
          }),
          rationale: "Guide food choices toward higher volume, lower calorie density options for satiety.",
          expectedEffect: "Reduce calorie intake by 200-300 kcal/day while maintaining satiety",
          precedence: "nutrition_foundation",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
];

const trainingGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["training_volume_deficit"],
    generate: (diagnosis, _context, _unifiedState) => {
      const muscles = diagnosis.evidence
        .map((e) => (e.payload as { muscle?: string }).muscle)
        .filter(Boolean);

      return [
        {
          kind: "training_volume_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "increase",
            targetMuscles: muscles,
            magnitudePercent: 15,
            reason: "volume_deficit",
          }),
          rationale: `Training volume below target for: ${muscles.join(", ")}. Increase volume for lagging muscles.`,
          expectedEffect: `Bring volume to 90%+ of target for ${muscles.length} muscle(s) within 3 weeks`,
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(21),
        },
      ];
    },
  },
  {
    handlesCodes: ["training_adherence_low"],
    generate: (diagnosis, _context, _unifiedState) => {
      const evidence = diagnosis.evidence[0];
      if (!evidence) return [];
      const adherence = (evidence.payload as { adherence?: number }).adherence ?? 0;

      return [
        {
          kind: "split_structure_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "reduce_frequency",
            targetFrequency: Math.max(2, Math.round(adherence * 4)),
            reason: "adherence_low",
          }),
          rationale: `Training adherence is ${Math.round(adherence * 100)}%. Reduce frequency to match realistic capacity.`,
          expectedEffect: `Achieve 90%+ adherence at reduced frequency within 2 weeks`,
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
        {
          kind: "session_structure_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "reduce_duration",
            targetDurationMinutes: 45,
            reason: "adherence_low",
          }),
          rationale: "Reduce session duration to lower barrier to completion.",
          expectedEffect: "Improve session completion rate",
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
  {
    handlesCodes: ["training_progression_stalled"],
    generate: (diagnosis, _context, _unifiedState) => {
      const exercises = diagnosis.evidence
        .map((e) => (e.payload as { exerciseName?: string }).exerciseName)
        .filter(Boolean);

      return [
        {
          kind: "progression_scheme_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "change_mechanism",
            targetExercises: exercises,
            newMechanism: "reps_first_then_load",
            reason: "progression_stalled",
          }),
          rationale: `Progression stalled for: ${exercises.join(", ")}. Change progression mechanism to reps-first.`,
          expectedEffect: `Resume measurable progression on ${exercises.length} exercise(s) within 4 weeks`,
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(28),
        },
        {
          kind: "exercise_substitution",
          parameters: sanitizeParams({
            targetExercises: exercises,
            substitutionType: "similar_movement_different_load",
            reason: "progression_stalled",
          }),
          rationale: "Substitute stalled exercises with similar movement patterns to provide novel stimulus.",
          expectedEffect: "Novel stimulus to break plateau",
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(28),
        },
      ];
    },
  },
  {
    handlesCodes: ["training_plateau_repeated_stagnation"],
    generate: (diagnosis, _context, _unifiedState) => {
      const exercises = diagnosis.evidence
        .map((e) => (e.payload as { affectedEntity?: string }).affectedEntity)
        .filter(Boolean);

      return [
        {
          kind: "progression_scheme_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "deload_then_rebuild",
            targetExercises: exercises,
            deloadPercent: 15,
            reason: "repeated_stagnation",
          }),
          rationale: `Repeated stagnation for: ${exercises.join(", ")}. Implement deload and rebuild cycle.`,
          expectedEffect: `Reset fatigue and resume progression within 6 weeks`,
          precedence: "training_progression",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(42),
        },
      ];
    },
  },
  {
    handlesCodes: ["training_plateau_declining_performance"],
    generate: (diagnosis, _context, _unifiedState) => {
      const exercises = diagnosis.evidence
        .map((e) => (e.payload as { affectedEntity?: string }).affectedEntity)
        .filter(Boolean);

      return [
        {
          kind: "training_volume_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "reduce",
            targetMuscles: exercises,
            magnitudePercent: 25,
            reason: "declining_performance",
          }),
          rationale: `Performance declining for: ${exercises.join(", ")}. Reduce volume to allow recovery.`,
          expectedEffect: `Stabilize performance and restore progression capacity within 3 weeks`,
          precedence: "recovery_blocking",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(21),
        },
        {
          kind: "recovery_adjustment",
          parameters: sanitizeParams({
            focus: "sleep_and_deload",
            targetSleepHours: 8,
            deloadDurationDays: 7,
            reason: "declining_performance",
          }),
          rationale: "Address declining performance with dedicated recovery period and sleep focus.",
          expectedEffect: "Restore readiness score above 70 within 2 weeks",
          precedence: "recovery_blocking",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
];

const bodyGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["body_weight_gaining_unintended", "body_weight_losing_unintended", "body_fat_increasing"],
    generate: (diagnosis, _context, _unifiedState) => {
      const isWeightGain = diagnosis.code.includes("gaining");
      const isFatIncrease = diagnosis.code.includes("fat_increasing");

      const interventions: ValidatedInterventionCandidate[] = [];

      if (isWeightGain || isFatIncrease) {
        interventions.push(
          {
            kind: "nutrition_target_adjustment",
            parameters: sanitizeParams({
              target: "calories",
              adjustmentType: "decrease",
              magnitudePercent: 10,
              reason: isFatIncrease ? "fat_gain" : "weight_gain",
            }),
            rationale: `${isWeightGain ? "Unintended weight gain" : "Body fat increasing"}. Create modest calorie deficit.`,
            expectedEffect: `${isWeightGain ? "Stabilize weight" : "Reduce body fat trend"} within 4 weeks`,
            precedence: "body_composition",
            addressesDiagnoses: [diagnosis.id],
            validations: [],
            isValid: true,
            confidence: "label_declared",
            reviewOn: addDaysISO(28),
          },
          {
            kind: "activity_target_adjustment",
            parameters: sanitizeParams({
              target: "daily_steps",
              adjustmentType: "increase",
              magnitudePercent: 20,
              reason: isFatIncrease ? "fat_gain" : "weight_gain",
            }),
            rationale: "Increase daily activity to increase energy expenditure.",
            expectedEffect: "Add 1000-2000 steps/day to support energy balance",
            precedence: "activity_alignment",
            addressesDiagnoses: [diagnosis.id],
            validations: [],
            isValid: true,
            confidence: "estimated",
            reviewOn: addDaysISO(21),
          },
        );
      } else {
        interventions.push(
          {
            kind: "nutrition_target_adjustment",
            parameters: sanitizeParams({
              target: "calories",
              adjustmentType: "increase",
              magnitudePercent: 10,
              reason: "weight_loss",
            }),
            rationale: "Unintended weight loss. Increase calories to stabilize weight.",
            expectedEffect: "Stabilize weight within 3 weeks",
            precedence: "body_composition",
            addressesDiagnoses: [diagnosis.id],
            validations: [],
            isValid: true,
            confidence: "label_declared",
            reviewOn: addDaysISO(21),
          },
        );
      }

      return interventions;
    },
  },
  {
    handlesCodes: ["disproportionate_development"],
    generate: (diagnosis, _context, _unifiedState) => {
      const muscles = diagnosis.evidence
        .map((e) => (e.payload as { muscle?: string }).muscle)
        .filter(Boolean);

      return [
        {
          kind: "training_volume_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "redistribute",
            targetMuscles: muscles,
            magnitudePercent: -20,
            reason: "disproportionate_development",
          }),
          rationale: `Disproportionate development in: ${muscles.join(", ")}. Reduce volume for overdeveloped muscles.`,
          expectedEffect: "Improve muscle balance within 8 weeks",
          precedence: "body_composition",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(56),
        },
        {
          kind: "exercise_substitution",
          parameters: sanitizeParams({
            targetExercises: muscles,
            substitutionType: "reduce_emphasis",
            reason: "disproportionate_development",
          }),
          rationale: "Substitute exercises that over-emphasize developed muscles with alternatives.",
          expectedEffect: "Shift stimulus toward lagging muscles",
          precedence: "body_composition",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(56),
        },
      ];
    },
  },
];

const recoveryGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["recovery_readiness_low", "hrv_declining", "sleep_debt_severe", "fatigue_accumulation_high"],
    generate: (diagnosis, _context, _unifiedState) => {
      const isSevere = diagnosis.severity === "urgent";

      const interventions: ValidatedInterventionCandidate[] = [
        {
          kind: "recovery_adjustment",
          parameters: sanitizeParams({
            focus: isSevere ? "comprehensive_recovery" : "sleep_and_stress",
            targetSleepHours: isSevere ? 8.5 : 8,
            deloadDurationDays: isSevere ? 14 : 7,
            stressManagement: true,
            reason: diagnosis.code,
          }),
          rationale: `${diagnosis.title}. Implement ${isSevere ? "comprehensive" : "targeted"} recovery protocol.`,
          expectedEffect: `Restore readiness score above 70 within ${isSevere ? "3" : "2"} weeks`,
          precedence: "recovery_blocking",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(isSevere ? 21 : 14),
        },
      ];

      if (diagnosis.code === "fatigue_accumulation_high") {
        interventions.push(
          {
            kind: "training_volume_adjustment",
            parameters: sanitizeParams({
              adjustmentType: "reduce",
              targetMuscles: ["systemic"],
              magnitudePercent: 30,
              reason: "high_fatigue",
            }),
            rationale: "High fatigue accumulation. Reduce training volume systemically.",
            expectedEffect: "Reduce ACWR to <1.0 within 2 weeks",
            precedence: "recovery_blocking",
            addressesDiagnoses: [diagnosis.id],
            validations: [],
            isValid: true,
            confidence: "label_declared",
            reviewOn: addDaysISO(14),
          },
        );
      }

      if (diagnosis.code === "sleep_debt_severe") {
        interventions.push(
          {
            kind: "measurement_protocol_adjustment",
            parameters: sanitizeParams({
              focus: "sleep_tracking",
              frequency: "daily",
              reason: "severe_sleep_debt",
            }),
            rationale: "Severe sleep debt. Implement daily sleep tracking and protocol.",
            expectedEffect: "Establish consistent sleep tracking and improve sleep hygiene",
            precedence: "recovery_blocking",
            addressesDiagnoses: [diagnosis.id],
            validations: [],
            isValid: true,
            confidence: "estimated",
            reviewOn: addDaysISO(14),
          },
        );
      }

      return interventions;
    },
  },
];

const projectionGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["projection_divergence_significant"],
    generate: (diagnosis, _context, _unifiedState) => {
      const targets = diagnosis.evidence
        .map((e) => (e.payload as { target?: string }).target)
        .filter(Boolean);

      return [
        {
          kind: "custom",
          parameters: sanitizeParams({
            action: "reassess_assumptions",
            targets,
            reason: "projection_divergence",
          }),
          rationale: `Projections diverging for: ${targets.join(", ")}. Reassess underlying assumptions.`,
          expectedEffect: "Identify and correct assumption violations within 2 weeks",
          precedence: "optimization",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(14),
        },
        {
          kind: "measurement_protocol_adjustment",
          parameters: sanitizeParams({
            focus: "measurement_consistency",
            frequency: "increase",
            reason: "projection_divergence",
          }),
          rationale: "Increase measurement frequency to improve projection accuracy.",
          expectedEffect: "Reduce projection uncertainty within 4 weeks",
          precedence: "optimization",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(28),
        },
      ];
    },
  },
];

const activityGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["activity_steps_low"],
    generate: (diagnosis, _context, _unifiedState) => {
      return [
        {
          kind: "activity_target_adjustment",
          parameters: sanitizeParams({
            target: "daily_steps",
            adjustmentType: "progressive_increase",
            magnitudePercent: 15,
            reason: "low_steps",
          }),
          rationale: "Daily steps below target. Progressive increase to build habit.",
          expectedEffect: "Reach 90%+ of step target within 3 weeks",
          precedence: "activity_alignment",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(21),
        },
      ];
    },
  },
  {
    handlesCodes: ["activity_cardio_low"],
    generate: (diagnosis, _context, _unifiedState) => {
      return [
        {
          kind: "activity_target_adjustment",
          parameters: sanitizeParams({
            target: "weekly_cardio",
            adjustmentType: "add_session",
            sessionDurationMinutes: 20,
            reason: "low_cardio",
          }),
          rationale: "Weekly cardio below target. Add manageable cardio session.",
          expectedEffect: "Reach 80%+ of cardio target within 2 weeks",
          precedence: "activity_alignment",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "label_declared",
          reviewOn: addDaysISO(14),
        },
      ];
    },
  },
];

const goalGenerators: InterventionGenerator[] = [
  {
    handlesCodes: ["goal_alignment_low"],
    generate: (diagnosis, _context, _unifiedState) => {
      const gaps = diagnosis.evidence
        .flatMap((e) => (e.payload as { gaps?: string[] }).gaps ?? [])
        .filter(Boolean);

      return [
        {
          kind: "split_structure_adjustment",
          parameters: sanitizeParams({
            adjustmentType: "realign_to_goal",
            targetGaps: gaps.join(", "),
            reason: "goal_misalignment",
          }),
          rationale: `Goal alignment is low. Gaps: ${gaps.join(", ")}. Adjust split to address gaps.`,
          expectedEffect: "Improve goal alignment score to 80+ within 4 weeks",
          precedence: "optimization",
          addressesDiagnoses: [diagnosis.id],
          validations: [],
          isValid: true,
          confidence: "estimated",
          reviewOn: addDaysISO(28),
        },
      ];
    },
  },
];

const ALL_GENERATORS = [
  ...nutritionGenerators,
  ...trainingGenerators,
  ...bodyGenerators,
  ...recoveryGenerators,
  ...projectionGenerators,
  ...activityGenerators,
  ...goalGenerators,
];

// ---------------------------------------------------------------------------
// Specialist Validators
// ---------------------------------------------------------------------------

type SpecialistValidator = (
  candidate: ValidatedInterventionCandidate,
  context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
) => SpecialistValidation;

function validateTraining(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "training_state");
  if (!slice) {
    return {
      engine: "training_state",
      valid: true,
      warnings: ["No training state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const trainingState = slice.payload as {
    currentPlanStatus?: string;
    weeklySessionFrequency?: number;
    progressionStatus?: Record<string, { status: string }>;
  };

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (candidate.kind === "training_volume_adjustment" || candidate.kind === "progression_scheme_adjustment") {
    if (trainingState.currentPlanStatus === "active") {
      warnings.push("Active training plan will need adaptation");
    }
  }

  if (candidate.kind === "split_structure_adjustment") {
    const params = candidate.parameters as { targetFrequency?: number };
    if (params.targetFrequency && trainingState.weeklySessionFrequency) {
      if (params.targetFrequency > trainingState.weeklySessionFrequency + 1) {
        conflicts.push(`Frequency increase of ${params.targetFrequency - trainingState.weeklySessionFrequency} sessions may exceed capacity`);
        adjustments.push("Consider gradual frequency increase over 2-3 weeks");
      }
    }
  }

  return {
    engine: "training_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateNutrition(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "nutrition_state");
  if (!slice) {
    return {
      engine: "nutrition_state",
      valid: true,
      warnings: ["No nutrition state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const nutritionState = slice.payload as {
    targets?: { proteinG: number; caloriesKcal: number };
    adherence?: { proteinPercent: number; caloriesPercent: number };
  };

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (candidate.kind === "nutrition_target_adjustment") {
    const params = candidate.parameters as { target: string; magnitudePercent: number };
    if (params.target === "calories" && params.magnitudePercent > 20) {
      warnings.push("Large calorie adjustment (>20%) may impact adherence");
      adjustments.push("Consider splitting into two 10% adjustments over 2 weeks");
    }
    if (params.target === "protein" && nutritionState.targets) {
      const newProtein = nutritionState.targets.proteinG * (1 + params.magnitudePercent / 100);
      if (newProtein > 3.5 * 75) {
        conflicts.push("Protein target may exceed practical upper limit");
        adjustments.push("Cap protein at 3.5g/kg and adjust calories instead");
      }
    }
  }

  return {
    engine: "nutrition_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateRecovery(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "recovery_state");
  if (!slice) {
    return {
      engine: "recovery_state",
      valid: true,
      warnings: ["No recovery state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const recoveryState = slice.payload as {
    readinessScore: number;
    fatigueAccumulation: string;
    sleepAdequacy: string;
  };

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (recoveryState.readinessScore < 50 && candidate.precedence === "training_progression") {
    conflicts.push("Training progression intervention conflicts with poor recovery");
    adjustments.push("Prioritize recovery intervention first; delay progression");
  }

  if (recoveryState.fatigueAccumulation === "very_high" && candidate.kind === "training_volume_adjustment") {
    const params = candidate.parameters as { adjustmentType?: string };
    if (params.adjustmentType === "increase") {
      conflicts.push("Increasing volume with very high fatigue is contraindicated");
      adjustments.push("Change to volume reduction or recovery intervention");
    }
  }

  if (recoveryState.sleepAdequacy === "severe_debt") {
    warnings.push("Severe sleep debt limits effectiveness of all interventions");
    adjustments.push("Prioritize sleep intervention before other changes");
  }

  return {
    engine: "recovery_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateBody(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "body_state");
  if (!slice) {
    return {
      engine: "body_state",
      valid: true,
      warnings: ["No body state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (candidate.kind === "nutrition_target_adjustment") {
    const params = candidate.parameters as { target: string; adjustmentType: string; magnitudePercent: number };
    if (params.target === "calories" && params.adjustmentType === "decrease" && params.magnitudePercent > 15) {
      warnings.push("Aggressive calorie deficit may increase muscle loss risk");
      adjustments.push("Ensure protein target is maintained or increased during deficit");
    }
  }

  return {
    engine: "body_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateActivity(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "activity_state");
  if (!slice) {
    return {
      engine: "activity_state",
      valid: true,
      warnings: ["No activity state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (candidate.kind === "activity_target_adjustment") {
    const params = candidate.parameters as { target: string; magnitudePercent?: number };
    if (params.target === "daily_steps" && params.magnitudePercent && params.magnitudePercent > 30) {
      warnings.push("Large step target increase may be unsustainable");
      adjustments.push("Cap weekly step increases at 10-15%");
    }
  }

  return {
    engine: "activity_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateGoal(
  candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  const slice = unifiedState.slices.find((s) => s.sourceKind === "goal_state");
  if (!slice) {
    return {
      engine: "goal_state",
      valid: true,
      warnings: ["No goal state available for validation"],
      conflicts: [],
      requiredAdjustments: [],
      confidence: "unknown",
    };
  }

  const warnings: string[] = [];
  const conflicts: string[] = [];
  const adjustments: string[] = [];

  if (candidate.kind === "nutrition_target_adjustment") {
    const params = candidate.parameters as { target: string; adjustmentType: string };
    const goalDirection = slice.payload && typeof slice.payload === "object" && "goal" in slice.payload
      ? (slice.payload as { goal?: { direction?: string } }).goal?.direction
      : undefined;

    if (goalDirection === "lose" && params.target === "calories" && params.adjustmentType === "increase") {
      conflicts.push("Calorie increase conflicts with fat loss goal");
      adjustments.push("Consider activity increase instead of calorie increase for deficit");
    }
    if (goalDirection === "gain" && params.target === "calories" && params.adjustmentType === "decrease") {
      conflicts.push("Calorie decrease conflicts with muscle gain goal");
      adjustments.push("Consider volume reduction instead of calorie decrease");
    }
  }

  return {
    engine: "goal_state",
    valid: conflicts.length === 0,
    warnings,
    conflicts,
    requiredAdjustments: adjustments,
    confidence: slice.confidence,
  };
}

function validateProjection(
  _candidate: ValidatedInterventionCandidate,
  _context: InterventionSelectionContext,
  _unifiedState: UnifiedFitCoachState,
): SpecialistValidation {
  return {
    engine: "projection_state",
    valid: true,
    warnings: ["Projection validation not yet implemented"],
    conflicts: [],
    requiredAdjustments: [],
    confidence: "estimated",
  };
}

const SPECIALIST_VALIDATORS: Record<UnifiedStateSourceKind, SpecialistValidator> = {
  training_state: validateTraining,
  nutrition_state: validateNutrition,
  recovery_state: validateRecovery,
  body_state: validateBody,
  activity_state: validateActivity,
  goal_state: validateGoal,
  projection_state: validateProjection,
};

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

function resolveConflicts(
  candidates: ValidatedInterventionCandidate[],
  config: InterventionSelectionConfiguration,
): ValidatedInterventionCandidate[] {
  const precedenceOrder: Record<InterventionPrecedence, number> = {
    critical_safety: 0,
    recovery_blocking: 1,
    nutrition_foundation: 2,
    training_progression: 3,
    body_composition: 4,
    activity_alignment: 5,
    maintenance: 6,
    optimization: 7,
  };

  const sorted = [...candidates].sort((a, b) =>
    precedenceOrder[a.precedence] - precedenceOrder[b.precedence],
  );

  if (config.requireAllCriticalValidations) {
    return sorted.filter((c) => {
      const criticalValidations = c.validations.filter((v) =>
        config.criticalEngines.includes(v.engine),
      );
      return criticalValidations.every((v) => v.valid);
    });
  }

  return sorted;
}

function deduplicateCandidates(
  candidates: ValidatedInterventionCandidate[],
): ValidatedInterventionCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.kind}:${JSON.stringify(c.parameters)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main Selection Function
// ---------------------------------------------------------------------------

/**
 * Select validated intervention candidates for diagnoses.
 */
export function selectInterventions(
  request: SelectInterventionsRequest,
  config: InterventionSelectionConfiguration = DEFAULT_INTERVENTION_SELECTION_CONFIGURATION,
): SelectInterventionsResult {
  const { diagnoses, context, unifiedState } = request;

  let allCandidates: ValidatedInterventionCandidate[] = [];

  for (const diagnosis of diagnoses) {
    for (const generator of ALL_GENERATORS) {
      if (generator.handlesCodes.some((code) => diagnosis.code === code || diagnosis.code.startsWith(code))) {
        const generated = generator.generate(diagnosis, context, unifiedState);
        allCandidates.push(...generated);
      }
    }
  }

  if (allCandidates.length === 0) {
    allCandidates.push({
      kind: "no_change",
      parameters: {},
      rationale: "No specific interventions identified. Current plan appears to be working.",
      expectedEffect: "Maintain current trajectory",
      precedence: "maintenance",
      addressesDiagnoses: [],
      validations: [],
      isValid: true,
      confidence: "label_declared",
      reviewOn: addDaysISO(7),
    });
  }

  const validatedCandidates = allCandidates.map((candidate) => {
    const validations: SpecialistValidation[] = [];

    for (const validator of Object.values(SPECIALIST_VALIDATORS)) {
      const validation = validator(candidate, context, unifiedState);
      validations.push(validation);
    }

    const isValid = validations.every((v) => v.valid);
    const overallConfidence = validations.reduce((min, v) => {
      const vRank = confidenceToRank(v.confidence);
      return Math.min(min, vRank);
    }, 4);

    const confidenceMap: Record<number, ConfidenceLevel> = {
      4: "measured",
      3: "label_declared",
      2: "estimated",
      1: "unknown",
    };

    return {
      ...candidate,
      validations,
      isValid,
      confidence: confidenceMap[overallConfidence] ?? "estimated",
    };
  });

  const resolved = resolveConflicts(validatedCandidates, config);
  const deduplicated = deduplicateCandidates(resolved);

  const filtered = deduplicated.filter((c) =>
    confidenceMeetsThreshold(c.confidence, config.minCandidateConfidence),
  );

  const finalCandidates = filtered.slice(0, config.maxCandidates);

  const addressedDiagnosisIds = new Set(
    finalCandidates.flatMap((c) => c.addressesDiagnoses),
  );
  const unaddressedDiagnoses = diagnoses
    .filter((d) => !addressedDiagnosisIds.has(d.id))
    .map((d) => d.id);

  const candidateConfidences = finalCandidates.map((c) => confidenceToRank(c.confidence));
  const overallConfidenceRank = candidateConfidences.length > 0
    ? Math.min(...candidateConfidences)
    : 1;
  const confidenceMap: Record<number, ConfidenceLevel> = {
    4: "measured",
    3: "label_declared",
    2: "estimated",
    1: "unknown",
  };
  const overallConfidence = confidenceMap[overallConfidenceRank] ?? "estimated";

  const rationaleParts: string[] = [];
  if (finalCandidates.length === 0) {
    rationaleParts.push("No valid interventions found after specialist validation.");
  } else {
    rationaleParts.push(
      `Selected ${finalCandidates.length} intervention(s) addressing ${finalCandidates.flatMap((c) => c.addressesDiagnoses).length} diagnosis(es).`,
    );
    const byPrecedence = new Map<InterventionPrecedence, number>();
    for (const c of finalCandidates) {
      byPrecedence.set(c.precedence, (byPrecedence.get(c.precedence) ?? 0) + 1);
    }
    for (const [prec, count] of byPrecedence.entries()) {
      rationaleParts.push(`${count} ${prec} intervention(s)`);
    }
  }

  if (unaddressedDiagnoses.length > 0) {
    rationaleParts.push(`${unaddressedDiagnoses.length} diagnosis(es) remain unaddressed.`);
  }

  return {
    candidates: finalCandidates,
    unaddressedDiagnoses,
    confidence: overallConfidence,
    rationale: rationaleParts.join(" "),
  };
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0] ?? "";
}

// ---------------------------------------------------------------------------
// Backward Compatibility
// ---------------------------------------------------------------------------

export interface LegacyInterventionSelectionContext {
  goal?: Goal;
  activeInterventions: readonly Intervention[];
  constraints: readonly string[];
}

export interface LegacyInterventionCandidate {
  kind: InterventionKind;
  parameters: InterventionParameters;
  rationale: string;
  expectedEffect: string;
  precedenceRank: number;
}

/**
 * @deprecated Use selectInterventions with Unified types instead.
 */
export function selectInterventionCandidates(
  _diagnoses: readonly Diagnosis[],
  _context: LegacyInterventionSelectionContext,
): LegacyInterventionCandidate[] {
  return [
    {
      kind: "no_change",
      parameters: {},
      rationale: "Legacy intervention selection - no unified state available",
      expectedEffect: "Maintain current plan",
      precedenceRank: 100,
    },
  ];
}