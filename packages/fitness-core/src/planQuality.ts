/**
 * Plan quality (Phase 3 §25).
 *
 * A decomposable evaluation: every component is inspectable, the total is a
 * documented weighted mean of the components that actually have evidence, and
 * a hard-constraint violation can never hide inside the number — consumers
 * must look at `hardViolations` before they look at `total`.
 *
 * Weights live in trainingConfig.ts (`PLAN_QUALITY_WEIGHTS`) so they can be
 * recalibrated without touching this algorithm.
 */

import { PLAN_QUALITY_WEIGHTS } from "./trainingConfig";

/** One quality dimension, 0..100. `null` = no evidence for this component. */
export type PlanQualityComponentValue = number | null;

export interface PlanQualityComponents {
  goalAlignment?: PlanQualityComponentValue;
  muscleCoverage?: PlanQualityComponentValue;
  volumeAppropriateness?: PlanQualityComponentValue;
  frequencyAppropriateness?: PlanQualityComponentValue;
  exerciseSuitability?: PlanQualityComponentValue;
  redundancy?: PlanQualityComponentValue;
  equipmentFeasibility?: PlanQualityComponentValue;
  preferenceCompatibility?: PlanQualityComponentValue;
  sessionDuration?: PlanQualityComponentValue;
  progressionReadiness?: PlanQualityComponentValue;
  constraintSatisfaction?: PlanQualityComponentValue;
}

export interface PlanQualityEvaluation {
  /** Only the components that carry evidence, 0..100. */
  components: Readonly<Record<string, number>>;
  /** Weighted mean over evidenced components; null when nothing is measurable. */
  total: number | null;
  /** Weight denominator actually used (so the mean is explainable). */
  appliedWeight: number;
  /** Components the caller could not measure — never silently scored as zero. */
  missingEvidence: readonly string[];
  /** Hard-constraint violations. Inspect these before trusting `total`. */
  hardViolations: readonly string[];
  /** True only when nothing hard is violated. */
  usable: boolean;
  weights: Readonly<Record<string, number>>;
}

const COMPONENT_KEYS: readonly (keyof PlanQualityComponents)[] = [
  "goalAlignment",
  "muscleCoverage",
  "volumeAppropriateness",
  "frequencyAppropriateness",
  "exerciseSuitability",
  "redundancy",
  "equipmentFeasibility",
  "preferenceCompatibility",
  "sessionDuration",
  "progressionReadiness",
  "constraintSatisfaction",
];

/**
 * Aggregate quality components into a transparent score.
 *
 * Missing evidence reduces the denominator instead of dragging the score to
 * zero: an unmeasured dimension is unknown, not bad.
 */
export function evaluatePlanQuality(
  components: PlanQualityComponents,
  options?: {
    weights?: Readonly<Record<string, number>>;
    hardViolations?: readonly string[];
  },
): PlanQualityEvaluation {
  const weights = options?.weights ?? PLAN_QUALITY_WEIGHTS;
  const hardViolations = [...(options?.hardViolations ?? [])];

  let weightedSum = 0;
  let appliedWeight = 0;
  const present: Record<string, number> = {};
  const missingEvidence: string[] = [];

  for (const key of COMPONENT_KEYS) {
    const value = components[key];
    if (value === undefined || value === null || !Number.isFinite(value)) {
      missingEvidence.push(key);
      continue;
    }
    const clamped = Math.max(0, Math.min(100, value));
    const weight = weights[key] ?? 0;
    present[key] = Math.round(clamped * 100) / 100;
    weightedSum += clamped * weight;
    appliedWeight += weight;
  }

  const total = appliedWeight > 0 ? Math.round((weightedSum / appliedWeight) * 100) / 100 : null;

  return {
    components: present,
    total,
    appliedWeight: Math.round(appliedWeight * 1000) / 1000,
    missingEvidence,
    hardViolations,
    usable: hardViolations.length === 0,
    weights,
  };
}

/**
 * Convert a pass/warn/fail assessment into a 0..100 component.
 * Documented mapping: pass = 100, warning-only = 70, issue = 40.
 */
export function scoreFromAssessment(issues: number, warnings: number): number {
  if (issues > 0) return 40;
  if (warnings > 0) return 70;
  return 100;
}

/**
 * Session-duration fit: 100 when inside the budget, decaying by two points
 * per minute over, and never below zero.
 */
export function scoreSessionDuration(exceedsBudget: boolean, varianceMinutes: number): number {
  if (!exceedsBudget) return 100;
  return Math.max(0, 100 - 2 * Math.abs(varianceMinutes));
}
