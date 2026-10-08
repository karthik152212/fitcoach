import type {
  AdaptationOutcome,
  AdaptationDecision,
  AdaptationThresholds,
  ExercisePerformance,
  PlateauSignal,
  PlanChange,
  PlanSummary,
} from "@fitcoach/domain";
import { DEFAULT_ADAPTATION_THRESHOLDS } from "./trainingConfig";
import type { WeeklyVolumeReport } from "./volume";

/**
 * Adaptation engine (Phase 3).
 *
 * Implements plan adaptation with the SMALLEST USEFUL CHANGE principle:
 *
 * Given a current plan summary, the weekly volume report and training-side
 * plateau signals, decide whether anything should change at all. A plan that
 * is working returns `no_change` with evidence; otherwise exactly one
 * targeted intervention is proposed — never a bundle of unrelated changes.
 *
 * Plan-to-plan comparison lives in `./planComparison` (canonical).
 */

// ---------------------------------------------------------------------------
// Plateau signal detection
// ---------------------------------------------------------------------------

/**
 * Detect training-side plateau signals from recent performance data.
 *
 * Signals are structured facts only: no diagnosis, no medical claims.
 */
export function detectPlateauSignals(
  _recentSessions: readonly unknown[],
  exercisePerformance: Readonly<Record<string, ExercisePerformance>>,
  thresholds: AdaptationThresholds = DEFAULT_ADAPTATION_THRESHOLDS,
): PlateauSignal[] {
  const signals: PlateauSignal[] = [];

  for (const [exerciseId, perf] of Object.entries(exercisePerformance)) {
    const completedSessions = perf.completedSessions;
    const incompleteSessions = perf.incompleteSessions;

    if (perf.trend === "stable" && completedSessions >= thresholds.stagnationThreshold) {
      signals.push({
        kind: "repeated_performance_stagnation",
        observation: `${exerciseId} has been stable for ${completedSessions} sessions.`,
        affectedEntity: exerciseId,
        severity: 0.5,
        observedWeeks: Math.ceil(completedSessions / 3),
      });
    }

    if (perf.trend === "declining" && incompleteSessions >= 2) {
      signals.push({
        kind: "declining_performance",
        observation: `${exerciseId} performance is declining (${incompleteSessions} incomplete sessions).`,
        affectedEntity: exerciseId,
        severity: 0.7,
        observedWeeks: Math.ceil(Math.max(completedSessions, 1) / 3),
      });
    }

    if (perf.trend === "declining" && completedSessions === 0) {
      signals.push({
        kind: "adherence_issue",
        observation: `${exerciseId} has not been completed in the recent window.`,
        affectedEntity: exerciseId,
        severity: 0.4,
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Adaptation decision
// ---------------------------------------------------------------------------

/**
 * Decide the smallest useful adaptation (or no change) for the current plan.
 *
 * Decision order is deterministic:
 *   1. no signals → no_change
 *   2. exactly one stagnating exercise → adjust its progression
 *   3. declining performance → reduce training stress
 *   4. volume under target → adjust volume (escalated when widespread)
 *   5. three or more unrelated signals → no_change pending structural review
 *   6. otherwise → no_change while monitoring
 */
export function makeAdaptationDecision(
  _currentSummary: PlanSummary,
  volumeReport: WeeklyVolumeReport,
  signals: readonly PlateauSignal[],
  _context: unknown,
  _goalContext: unknown,
  thresholds: AdaptationThresholds = DEFAULT_ADAPTATION_THRESHOLDS,
): AdaptationDecision {
  const changes: PlanChange[] = [];
  const triggeringSignals: PlateauSignal[] = [];

  if (signals.length === 0) {
    return {
      outcome: "no_change",
      rationale: "No training-side signals detected. The current plan appears to be working.",
      triggeringSignals: [],
      changes: [],
      monitoringPlan: [
        "Continue tracking performance weekly",
        "Re-evaluate after 4 weeks or on next check-in",
      ],
      smallestUsefulChangeJustification:
        "No change is the smallest useful intervention when there are no signals requiring response.",
    };
  }

  const byKind = groupSignalsByKind(signals);

  // Performance stagnation → progression adjustment
  const stagnationSignals = byKind["repeated_performance_stagnation"] ?? [];
  const firstStagnation = stagnationSignals[0];
  if (stagnationSignals.length === 1 && firstStagnation) {
    triggeringSignals.push(firstStagnation);

    changes.push({
      kind: "modify_progression",
      description: `Adjust progression for ${firstStagnation.affectedEntity ?? "the affected exercise"}.`,
      affectedExercises: [firstStagnation.affectedEntity ?? ""] as PlanChange["affectedExercises"],
      reason: "Performance has been stable.",
      evidence: firstStagnation.observation,
      confidence: 0.7,
    });

    return buildAdaptationDecision("modify_progression", changes, triggeringSignals);
  }

  // Declining performance → reduce stress
  const decliningSignals = byKind["declining_performance"] ?? [];
  const firstDeclining = decliningSignals[0];
  if (firstDeclining) {
    triggeringSignals.push(firstDeclining);

    changes.push({
      kind: "reduce_training_stress",
      description: `Reduce training stress for ${firstDeclining.affectedEntity ?? "the affected exercise"}.`,
      affectedExercises: [firstDeclining.affectedEntity ?? ""] as PlanChange["affectedExercises"],
      reason: "Performance declining.",
      evidence: firstDeclining.observation,
      confidence: 0.75,
    });

    return buildAdaptationDecision("reduce_training_stress", changes, triggeringSignals);
  }

  // Volume issues — escalate the description when the deficit is widespread
  if (volumeReport.underTargetMuscles.length > 0) {
    const muscle = volumeReport.underTargetMuscles[0];
    triggeringSignals.push({
      kind: "insufficient_volume_signal",
      observation: `${muscle} is below target volume.`,
      affectedEntity: muscle,
      severity: 0.6,
    });

    const underTargetFraction =
      volumeReport.byMuscle.length > 0
        ? volumeReport.underTargetMuscles.length / volumeReport.byMuscle.length
        : 0;
    const widespread = underTargetFraction >= thresholds.underTargetFraction;

    const currentVol =
      volumeReport.byMuscle.find((m) => m.muscleSlug === muscle)?.totalEffectiveSets ?? 0;
    changes.push({
      kind: "adjust_volume",
      description: widespread
        ? `Increase volume across ${volumeReport.underTargetMuscles.length} under-target muscles, starting with ${muscle}.`
        : `Increase volume for ${muscle}.`,
      affectedMuscles: [...volumeReport.underTargetMuscles],
      reason: widespread
        ? `${Math.round(underTargetFraction * 100)}% of trained muscles are below target (threshold ${Math.round(thresholds.underTargetFraction * 100)}%).`
        : "Volume below target.",
      evidence: `Current: ${currentVol} effective sets.`,
      confidence: 0.7,
    });

    return buildAdaptationDecision("adjust_volume", changes, triggeringSignals);
  }

  // Multiple unrelated signals → structural review
  if (signals.length >= 3) {
    return {
      outcome: "no_change",
      rationale: `${signals.length} signals detected. Recommend structural review before making changes.`,
      triggeringSignals: [...signals],
      changes: [],
      monitoringPlan: ["Review overall training structure", "Re-evaluate before making changes"],
      smallestUsefulChangeJustification:
        "Multiple unrelated signals suggest a structural issue. No change until the analysis is done.",
    };
  }

  // Fallback
  return {
    outcome: "no_change",
    rationale: `${signals.length} signal(s) detected but no clear intervention identified. Continuing to monitor.`,
    triggeringSignals: [...signals],
    changes: [],
    monitoringPlan: ["Continue tracking signals", "Re-evaluate in 1-2 weeks"],
    smallestUsefulChangeJustification:
      "Monitoring is appropriate when signals don't clearly indicate a specific intervention.",
  };
}

function buildAdaptationDecision(
  outcome: AdaptationOutcome,
  changes: PlanChange[],
  triggeringSignals: PlateauSignal[],
): AdaptationDecision {
  return {
    outcome,
    rationale: getRationale(outcome, changes),
    triggeringSignals,
    changes,
    monitoringPlan: ["Track affected metrics for 2-4 weeks", "Re-evaluate if no improvement"],
    smallestUsefulChangeJustification: getJustification(outcome, changes),
  };
}

function getRationale(outcome: AdaptationOutcome, changes: PlanChange[]): string {
  if (outcome === "no_change") return "No change: plan appears to be working.";
  if (outcome === "modify_progression") return "Adjusting progression approach for stagnating exercise.";
  if (outcome === "reduce_training_stress") return "Reducing training stress to allow recovery.";
  if (outcome === "adjust_volume") return "Adjusting volume to address deficit.";
  if (outcome === "adjust_session") return "Adjusting session to fit time budget.";
  return `Making targeted adaptation covering ${changes.length} change(s).`;
}

function getJustification(outcome: AdaptationOutcome, changes: PlanChange[]): string {
  if (outcome === "no_change") {
    return "No change is the appropriate response when signals don't indicate a clear intervention.";
  }
  if (changes.length === 1) return "A single targeted change addresses the primary signal.";
  return "Multiple coordinated changes address the detected signals.";
}

function groupSignalsByKind(
  signals: readonly PlateauSignal[],
): Record<string, PlateauSignal[]> {
  const groups: Record<string, PlateauSignal[]> = {};
  for (const signal of signals) {
    const group = groups[signal.kind];
    if (group) {
      group.push(signal);
    } else {
      groups[signal.kind] = [signal];
    }
  }
  return groups;
}
