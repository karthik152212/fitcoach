import type {
  PlanSummary,
  PlanComparison,
  MuscleVolumeChange,
  ExerciseChange,
  SessionDurationChange,
  PlanChange,
  PlanChangeKind,
  EnvironmentLimitation,
  ProgressionMechanismChange,
  SubstitutionChange,
  TrainingEnvironmentKind,
} from "@fitcoach/domain";
import type { WeeklyVolumeReport } from "./volume";
import type { EnvironmentSubstitution } from "./trainingEnvironment";

/**
 * Plan comparison (Phase 3).
 *
 * Compares two plan versions and produces a structured comparison suitable
 * for both internal logic and future UI/AI explanation.
 */

/**
 * Phase 3.1 inputs: what the two plans were performed in, and what the
 * environment forced. Every field is optional, so a same-environment
 * comparison behaves exactly as it did in Phase 3.
 */
export interface PlanComparisonEnvironmentInput {
  planAEnvironmentKind?: TrainingEnvironmentKind;
  planBEnvironmentKind?: TrainingEnvironmentKind;
  substitutions?: readonly EnvironmentSubstitution[];
  limitations?: readonly EnvironmentLimitation[];
  /** exerciseId → ordered progression levers for the AFTER plan. */
  progressionMechanisms?: Readonly<Record<string, readonly string[]>>;
  loadProgressionAvailable?: boolean;
}

/**
 * Compare two plans and produce a detailed comparison.
 *
 * @param planA - The before plan summary.
 * @param planB - The after plan summary.
 * @param volumeA - Volume report for plan A.
 * @param volumeB - Volume report for plan B.
 * @param environment - Optional environment context (Phase 3.1).
 * @returns Structured plan comparison.
 */
export function comparePlans(
  planA: PlanSummary,
  planB: PlanSummary,
  volumeA: WeeklyVolumeReport,
  volumeB: WeeklyVolumeReport,
  environment?: PlanComparisonEnvironmentInput,
): PlanComparison {
  const changes: PlanChange[] = [];
  const muscleVolumeChanges: MuscleVolumeChange[] = [];
  const exerciseChanges: ExerciseChange[] = [];
  const sessionDurationChanges: SessionDurationChange[] = [];

  // 1. Exercise changes
  const setA = new Set(planA.exerciseIds);
  const setB = new Set(planB.exerciseIds);

  for (const id of setA) {
    if (!setB.has(id)) {
      exerciseChanges.push({ exerciseId: id, exerciseName: `Exercise ${id}`, change: "removed" });
      changes.push(makeChange("replace_exercise", `Removed exercise ${id}`, [id], [], "Exercise removed from plan"));
    }
  }

  for (const id of setB) {
    if (!setA.has(id)) {
      exerciseChanges.push({ exerciseId: id, exerciseName: `Exercise ${id}`, change: "added" });
      changes.push(makeChange("replace_exercise", `Added exercise ${id}`, [id], [], "Exercise added to plan"));
    }
  }

  // 2. Muscle volume changes
  const allMuscles = new Set([
    ...volumeA.byMuscle.map(m => m.muscleSlug),
    ...volumeB.byMuscle.map(m => m.muscleSlug),
  ]);

  for (const muscleSlug of allMuscles) {
    const volA = volumeA.byMuscle.find(m => m.muscleSlug === muscleSlug)?.totalEffectiveSets ?? 0;
    const volB = volumeB.byMuscle.find(m => m.muscleSlug === muscleSlug)?.totalEffectiveSets ?? 0;
    const delta = volB - volA;

    muscleVolumeChanges.push({
      muscleSlug,
      planAVolume: volA,
      planBVolume: volB,
      delta,
      direction: delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged",
    });

    if (Math.abs(delta) >= 1) {
      changes.push(makeChange(
        "adjust_volume",
        `${muscleSlug} volume ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta)} effective sets`,
        [],
        [muscleSlug],
        `Volume adjustment for ${muscleSlug}.`,
      ));
    }
  }

  // 3. Session duration changes
  const durationDelta = planB.estimatedWeeklyDurationMinutes - planA.estimatedWeeklyDurationMinutes;
  if (Math.abs(durationDelta) >= 5) {
    sessionDurationChanges.push({
      sessionId: planA.sessions[0]?.sessionId ?? "weekly_total",
      planADuration: planA.estimatedWeeklyDurationMinutes,
      planBDuration: planB.estimatedWeeklyDurationMinutes,
      deltaMinutes: durationDelta,
    });

    changes.push(makeChange(
      "adjust_session",
      `Weekly duration ${durationDelta > 0 ? "increased" : "decreased"} by ${Math.abs(durationDelta)} minutes`,
      [],
      [],
      `Session duration adjustment.`,
    ));
  }

  // 4. Frequency changes (simplified — would compare per-muscle session counts)
  // Deferred for full implementation

  // 5. Split changes
  const splitChanged = planA.totalSessions !== planB.totalSessions ||
    planA.sessions.length !== planB.sessions.length;

  // 6. Environment context (Phase 3.1): substitutions, limits, progression.
  const substitutions: SubstitutionChange[] = (environment?.substitutions ?? [])
    .map((item) => ({
      originalExerciseId: item.originalExerciseId,
      originalExerciseName: item.originalExerciseName,
      replacementExerciseId: item.replacementExerciseId,
      replacementExerciseName: item.replacementExerciseName,
      reason: item.reason,
      equivalence: item.equivalence,
      stimulusSimilarity: item.stimulusSimilarity,
      musclesPreserved: item.musclesPreserved,
      musclesLost: item.musclesLost,
      relationship: item.relationship,
    }))
    .sort(
      (a, b) =>
        a.originalExerciseName.localeCompare(b.originalExerciseName) ||
        a.replacementExerciseName.localeCompare(b.replacementExerciseName),
    );

  const limitations: EnvironmentLimitation[] = [...(environment?.limitations ?? [])].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject),
  );

  const progressionMechanisms: ProgressionMechanismChange[] = Object.entries(
    environment?.progressionMechanisms ?? {},
  )
    .map(([exerciseId, mechanisms]) => ({
      exerciseId,
      exerciseName: exerciseId,
      mechanisms: [...mechanisms],
      loadAvailable: mechanisms.includes("load"),
    }))
    .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));

  const kindA = environment?.planAEnvironmentKind;
  const kindB = environment?.planBEnvironmentKind;
  const environmentChanges =
    kindA !== undefined || kindB !== undefined
      ? `${kindA ?? "unknown"} → ${kindB ?? "unknown"}${
          environment?.loadProgressionAvailable === false
            ? "; external-load progression unavailable"
            : ""
        }`
      : undefined;

  return {
    planAId: planA.planVersionId,
    planBId: planB.planVersionId,
    changes,
    muscleVolumeChanges,
    frequencyChanges: [],
    exerciseChanges,
    sessionDurationChanges,
    splitChanges: splitChanged ? `Sessions changed from ${planA.totalSessions} to ${planB.totalSessions}` : undefined,
    progressionChanges: progressionMechanisms.length > 0
      ? progressionMechanisms
          .map((entry) => `${entry.exerciseId}: ${entry.mechanisms.join(" → ")}`)
          .join("; ")
      : undefined,
    constraintChanges: limitations.length > 0
      ? limitations.map((limit) => `${limit.kind}:${limit.subject}`).join("; ")
      : undefined,
    goalAlignmentChanges: undefined,
    ...(environmentChanges !== undefined ? { environmentChanges } : {}),
    ...(substitutions.length > 0 ? { substitutions } : {}),
    ...(limitations.length > 0 ? { limitations } : {}),
    ...(progressionMechanisms.length > 0 ? { progressionMechanisms } : {}),
    orderedBy: "delta_magnitude",
  };
}

/**
 * Create a plan change object.
 */
function makeChange(
  kind: PlanChangeKind,
  description: string,
  affectedExercises: readonly string[] = [],
  affectedMuscles: readonly string[] = [],
  evidence?: string,
  confidence = 0.8,
): PlanChange {
  return {
    kind,
    description,
    affectedExercises,
    affectedMuscles,
    reason: description,
    evidence,
    confidence,
  };
}

/**
 * Summarize a plan comparison for human-readable output.
 */
export function summarizePlanComparison(comparison: PlanComparison): string[] {
  const lines: string[] = [];

  if (comparison.exerciseChanges.length > 0) {
    const added = comparison.exerciseChanges.filter(c => c.change === "added").length;
    const removed = comparison.exerciseChanges.filter(c => c.change === "removed").length;

    if (added > 0) lines.push(`Added ${added} exercise(s).`);
    if (removed > 0) lines.push(`Removed ${removed} exercise(s).`);
  }

  if (comparison.muscleVolumeChanges.length > 0) {
    const increased = comparison.muscleVolumeChanges.filter(c => c.direction === "increased");
    const decreased = comparison.muscleVolumeChanges.filter(c => c.direction === "decreased");

    if (increased.length > 0) {
      lines.push(`Volume increased for: ${increased.map(c => c.muscleSlug).join(", ")}.`);
    }
    if (decreased.length > 0) {
      lines.push(`Volume decreased for: ${decreased.map(c => c.muscleSlug).join(", ")}.`);
    }
  }

  if (comparison.sessionDurationChanges.length > 0) {
    const delta = comparison.sessionDurationChanges[0]?.deltaMinutes ?? 0;
    lines.push(`Weekly duration ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta)} minutes.`);
  }

  if (comparison.splitChanges) {
    lines.push(`Split structure changed: ${comparison.splitChanges}.`);
  }

  // Phase 3.1: an environment comparison must state what it could NOT preserve.
  if (comparison.environmentChanges) {
    lines.push(`Environment changed: ${comparison.environmentChanges}.`);
  }
  for (const substitution of comparison.substitutions ?? []) {
    lines.push(
      `${substitution.originalExerciseName} → ${substitution.replacementExerciseName} (${substitution.equivalence}; ${substitution.reason}).`,
    );
  }
  for (const limitation of comparison.limitations ?? []) {
    lines.push(`Limitation (${limitation.kind}) ${limitation.subject}: ${limitation.description}`);
  }

  if (lines.length === 0) {
    lines.push("No significant changes between these plans.");
  }

  return lines;
}
