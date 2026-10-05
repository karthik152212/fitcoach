/**
 * AI orchestration boundary.
 *
 * BINDING RULES
 * -------------
 * 1. The LLM is never the source of truth. Calories, macros, training volume,
 *    muscle coverage, body trends, diagnoses and validated interventions are
 *    produced exclusively by the deterministic packages
 *    (@fitcoach/fitness-core, @fitcoach/nutrition) operating on
 *    @fitcoach/domain data.
 *
 * 2. The AI layer may: parse natural-language input, explain deterministic
 *    findings, summarize progress, ask clarifying questions, and choose or
 *    present among interventions that deterministic logic has already
 *    validated.
 *
 * 3. The AI must never silently invent or mutate authoritative facts:
 *    measurements, calories, exercise availability, training history,
 *    diagnoses or targets. It cannot "know" things the domain data does not.
 *
 * 4. Any AI output that asserts a fact must be traceable to a deterministic
 *    result. Unverifiable statements are user-facing prose only and must not
 *    be persisted as data.
 */
import type { Diagnosis, Intervention, Recommendation } from "@fitcoach/domain";

export const AI_PACKAGE_STATUS = "boundary-only" as const;

/**
 * A parsed natural-language food log. Candidates are guesses that require
 * validation by the nutrition package (and often the user) before they may
 * touch authoritative state.
 */
export interface ParsedFoodLogCandidate {
  rawText: string;
  candidates: readonly {
    description: string;
    proposedQuantityGrams?: number;
    confidenceHint?: "low" | "medium" | "high";
  }[];
  requiresUserConfirmation: boolean;
}

/**
 * Ports the AI layer will expose once implemented. Signatures are
 * provisional; no SDK or provider integration exists yet by design.
 */
export interface AiCoordinatorPort {
  parseFoodLog(rawText: string): Promise<ParsedFoodLogCandidate>;
  explainDiagnosis(diagnosis: Diagnosis): Promise<string>;
  explainIntervention(intervention: Intervention): Promise<string>;
  presentRecommendation(recommendation: Recommendation): Promise<string>;
}
