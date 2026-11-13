/**
 * Evidence intelligence for the AI Coach.
 *
 * Evaluates the quality, freshness, completeness, and reliability of evidence
 * retrieved from FitCoach specialist systems. Never converts missing information
 * into zero or fabricates measurements.
 *
 * All functions are deterministic: same inputs always produce same outputs.
 */

import type {
  ConfidenceLevel,
  ProvenanceClass,
  Timestamp,
} from "@fitcoach/domain";
import type { ContextQuality, ContextSourceSnapshot } from "./contracts";

/**
 * Result of evaluating a single evidence item.
 */
export interface EvidenceQuality {
  /** Which specialist domain produced this evidence. */
  source: string;
  /** Machine code identifying the finding, if available. */
  code?: string;
  /** Human-readable title/description. */
  title: string;
  /** When the observation was originally made. */
  observedAt?: Timestamp;
  /** When this evidence was retrieved for context building. */
  retrievedAt: Timestamp;
  /** How the observation originated. */
  provenance: ProvenanceClass;
  /** Confidence in this evidence. */
  confidence: ConfidenceLevel;
  /** Staleness in days since last observation. */
  stalenessDays: number;
  /** Whether this evidence is considered stale for coaching purposes. */
  isStale: boolean;
  /** Completeness percentage (0-100). */
  completenessPercent: number;
  /** Expected fields that are absent. */
  missingFields: readonly string[];
  /** Sample size (number of observations), when applicable. */
  sampleSize?: number;
  /** Whether the evidence is noisy (high variance, few observations). */
  isNoisy: boolean;
  /** Human-readable quality warnings. */
  warnings: readonly string[];
}

/**
 * Staleness thresholds per evidence domain, in days.
 * Beyond these thresholds, evidence is considered stale.
 */
export interface StalenessThresholds {
  training_state: number;   // default 7
  nutrition_state: number;  // default 3
  activity_state: number;   // default 7
  recovery_state: number;   // default 2
  body_state: number;       // default 28
  projection_state: number; // default 30
  decision_state: number;   // default 14
  conversation_state: number; // default 1
}

/**
 * Default staleness thresholds.
 */
export const DEFAULT_STALENESS_THRESHOLDS: StalenessThresholds = {
  training_state: 7,
  nutrition_state: 3,
  activity_state: 7,
  recovery_state: 2,
  body_state: 28,
  projection_state: 30,
  decision_state: 14,
  conversation_state: 1,
};

/**
 * Configuration for evidence evaluation.
 */
export interface EvidenceEvaluationConfig {
  stalenessThresholds: StalenessThresholds;
  minSampleSizeForConfidence: number; // default 3
  maxStalenessForHighConfidence: number; // default 7
}

/**
 * Default evaluation config.
 */
export const DEFAULT_EVIDENCE_EVALUATION_CONFIG: EvidenceEvaluationConfig = {
  stalenessThresholds: DEFAULT_STALENESS_THRESHOLDS,
  minSampleSizeForConfidence: 3,
  maxStalenessForHighConfidence: 7,
};

/**
 * Parse a timestamp string to a Date, returning undefined if invalid.
 */
function safeParseTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Compute days between two timestamps.
 */
function daysBetween(earlier: Date | undefined, later: Date | undefined): number {
  if (!earlier || !later) return Number.POSITIVE_INFINITY;
  const diffMs = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Determine if an evidence item is noisy based on sample size and variance.
 * A small number of observations with high variance is considered noisy.
 */
function isEvidenceNoisy(sampleSize?: number, variance?: number): boolean {
  if (sampleSize === undefined) return false;
  if (sampleSize < 2) return true; // single observation is always noisy
  if (variance !== undefined && variance > 0 && sampleSize < 5) return true;
  return false;
}

/**
 * Evaluate the quality of a single evidence item.
 *
 * @param source - Specialist domain name
 * @param code - Machine code for the finding
 * @param title - Human-readable title
 * @param observedAt - When the observation was made
 * @param provenance - How the observation originated
 * @param confidence - Confidence level
 * @param sampleSize - Number of observations (optional)
 * @param variance - Variance measure (optional)
 * @param missingFields - Fields that are expected but absent
 * @param config - Evaluation configuration
 * @param asOf - Reference date for staleness calculation
 */
export function evaluateEvidenceQuality({
  source,
  code,
  title,
  observedAt,
  provenance,
  confidence,
  sampleSize,
  variance,
  missingFields = [],
  config = DEFAULT_EVIDENCE_EVALUATION_CONFIG,
  asOf = new Date(),
}: {
  source: string;
  code?: string;
  title: string;
  observedAt?: Timestamp;
  provenance: ProvenanceClass;
  confidence: ConfidenceLevel;
  sampleSize?: number;
  variance?: number;
  missingFields?: readonly string[];
  config?: EvidenceEvaluationConfig;
  asOf?: Date | Timestamp;
}): EvidenceQuality {
  const observedDate = safeParseTimestamp(observedAt);
  const retrievedAt = new Date();
  const stalenessDays = daysBetween(observedDate, asOf instanceof Date ? asOf : new Date(asOf));

  // Determine staleness threshold for this domain
  const threshold =
    config.stalenessThresholds[
      source as keyof StalenessThresholds
    ] ?? config.stalenessThresholds.decision_state;

  const isStale = stalenessDays > threshold;

  // Completeness: penalize missing fields
  const completenessPercent =
    missingFields.length === 0 ? 100 : Math.max(0, 100 - missingFields.length * 20);

  const warnings: string[] = [];

  if (isStale) {
    warnings.push(
      `Data from ${stalenessDays} day(s) ago exceeds ${threshold}-day staleness threshold for ${source}`,
    );
  }
  if (missingFields.length > 0) {
    warnings.push(`Missing fields: ${missingFields.join(", ")}`);
  }
  if (isEvidenceNoisy(sampleSize, variance)) {
    warnings.push(`Limited sample size (${sampleSize ?? "unknown"}) — treat as indicative`);
  }
  if (confidence === "unknown") {
    warnings.push("Confidence level unknown");
  }

  return {
    source,
    code,
    title,
    observedAt,
    retrievedAt: retrievedAt.toISOString(),
    provenance,
    confidence,
    stalenessDays,
    isStale,
    completenessPercent,
    missingFields,
    sampleSize,
    isNoisy: isEvidenceNoisy(sampleSize, variance),
    warnings,
  };
}

/**
 * Evaluate the overall quality of a context assembled from multiple sources.
 *
 * @param sourceSnapshots - Per-source snapshots with quality info
 * @param asOf - Reference date
 */
export function evaluateContextQuality(
  sourceSnapshots: readonly ContextSourceSnapshot[],
): ContextQuality {

  // Weight sources equally for overall score
  const sourceCount = sourceSnapshots.length;
  const totalScore =
    sourceCount === 0
      ? 0
      : sourceSnapshots.reduce((sum, s) => {
          // Base score from completeness and confidence
          let score = s.completenessPercent;
          // Penalize staleness
          if (s.isStale) score *= 0.5;
          // Penalize low confidence
          if (s.confidence === "unknown") score *= 0.6;
          else if (s.confidence === "estimated") score *= 0.8;
          // Penalize missing fields
          score -= s.missingFields.length * 5;
          return sum + Math.max(0, Math.min(100, score));
        }, 0);

  const overallScore = sourceCount === 0 ? 0 : Math.round(totalScore / sourceCount);

  const missingDataWarnings: string[] = [];
  const staleDataWarnings: string[] = [];
  const recommendedFollowUpQuestions: string[] = [];

  for (const s of sourceSnapshots) {
    if (s.completenessPercent < 50) {
      missingDataWarnings.push(
        `${s.label}: only ${s.completenessPercent}% complete (missing: ${s.missingFields.join(", ")})`,
      );
    }
    if (s.isStale) {
      staleDataWarnings.push(
        `${s.label}: data is ${s.stalenessDays} day(s) old (threshold: stale)`,
      );
    }
    if (s.completenessPercent < 30 || s.isStale) {
      recommendedFollowUpQuestions.push(
        `Can you provide more recent ${s.label.toLowerCase()} data?`,
      );
    }
  }

  const sufficientForAdvice =
    overallScore >= 60 &&
    missingDataWarnings.length === 0 &&
    staleDataWarnings.length === 0;

  return {
    overallScore,
    sources: sourceSnapshots,
    missingDataWarnings,
    staleDataWarnings,
    recommendedFollowUpQuestions,
    sufficientForAdvice,
  };
}

/**
 * Convert an EvidenceQuality to a ContextSourceSnapshot for inclusion in a
 * PersonalContextSnapshot.
 */
export function evidenceQualityToSourceSnapshot(
  eq: EvidenceQuality,
  label: string,
): ContextSourceSnapshot {
  return {
    source: eq.source,
    label,
    lastObservedAt: eq.observedAt,
    stalenessDays: eq.stalenessDays,
    isStale: eq.isStale,
    completenessPercent: eq.completenessPercent,
    confidence: eq.confidence,
    missingFields: eq.missingFields,
    warnings: eq.warnings,
  };
}

/**
 * Check if a timestamp is stale beyond a given threshold.
 */
export function isStaleBeyond(
  observedAt: Timestamp | undefined,
  thresholdDays: number,
  asOf: Date | Timestamp = new Date(),
): { isStale: boolean; stalenessDays: number } {
  const observedDate = safeParseTimestamp(observedAt);
  const stalenessDays = daysBetween(
    observedDate,
    asOf instanceof Date ? asOf : new Date(asOf),
  );
  return { isStale: stalenessDays > thresholdDays, stalenessDays };
}
