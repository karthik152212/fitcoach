/**
 * Response Validator — Phase 9.3
 *
 * Validates a raw AI provider response before it is persisted or surfaced to
 * the user. Validation is structured: response fields (proposed actions,
 * evidence references, decision context, quality flags) are the primary
 * mechanism; free-text matching is only a secondary sanity check.
 *
 * The validator never injects facts into the answer. It can flag problems,
 * append disclosed quality warnings, and mark the response invalid — the
 * orchestrator decides whether to persist or reject.
 */

import type {
  CoachingRequest,
  CoachingDecisionContext,
  ContextQuality,
  PersonalContextSnapshot,
  ProviderResponse,
} from "@fitcoach/ai";
import type { TypedActionRegistry } from "./actionRegistry";

/** Outcome of validating a provider response. */
export interface ResponseValidationInput {
  response: ProviderResponse;
  coachingRequest: CoachingRequest;
  contextSnapshot: PersonalContextSnapshot;
  decisionContext: CoachingDecisionContext;
  /** Provider metadata (mock vs live) — used to enforce mock labeling. */
  providerIsMock: boolean;
}

/**
 * Keywords that, when asserted about the user's plan while the current
 * decision is `no_change`, indicate a potential contradiction unless the
 * response explicitly identifies the existing decision.
 */
const CONTRADICTION_KEYWORDS = [
  "must change",
  "must increase",
  "must decrease",
  "you must",
  "reverse",
  "override",
  "ignore the decision",
];

/** Domains whose active intervention an action may try to override. */
const ACTION_DOMAIN_INTERVENTIONS: Record<string, string[]> = {
  adjust_nutrition_target: ["nutrition_target_adjustment"],
  adjust_training_volume: ["training_volume_adjustment"],
  log_food: ["nutrition_target_adjustment"],
  log_workout: ["training_volume_adjustment"],
  record_measurement: [],
  update_goal: [],
  reevaluate_decision: [],
  custom: [],
};

/**
 * Structured validation of a provider response.
 *
 * Returns `{ valid, errors, warnings, sanitizedAnswer }`. When `valid` is
 * false the response must not be persisted or surfaced as coaching output.
 */
export class ResponseValidator {
  constructor(private readonly actionRegistry: TypedActionRegistry) {}

  validate(input: ResponseValidationInput): {
    valid: boolean;
    errors: readonly string[];
    warnings: readonly string[];
    sanitizedAnswer: string;
  } {
    const { response, contextSnapshot, decisionContext, providerIsMock } = input;
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedAnswer = response.answer;

    // ------------------------------------------------------------------
    // 1. Mock labeling — mock responses must be explicitly labeled.
    // ------------------------------------------------------------------
    if (providerIsMock && response.isMock !== true) {
      errors.push(
        "mock provider response is not labeled with isMock: true",
      );
    }
    if (!providerIsMock && response.isMock === true) {
      warnings.push(
        "response is labeled as mock but was not produced by the mock provider",
      );
    }

    // ------------------------------------------------------------------
    // 2. No-change is a valid outcome — never reject on its own.
    // (documented here; no check needed, handled below as allowed.)
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // 3. Confidence / uncertainty represented honestly.
    // ------------------------------------------------------------------
    if (response.confidence !== undefined) {
      if (typeof response.confidence !== "number" || !Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1) {
        errors.push("provider confidence must be a number between 0 and 1");
      }
    }

    // ------------------------------------------------------------------
    // 4. Decision-context contradiction check (structured).
    //    The response must not override the current Unified Decision Brain
    //    result without explicitly identifying the conflict.
    // ------------------------------------------------------------------
    const currentDecision = decisionContext.decisionSnapshot;
    const activeInterventions = new Set(decisionContext.activeInterventions ?? []);

    for (const proposed of response.proposedActions ?? []) {
      const entry = this.actionRegistry.get(proposed.kind);
      if (!entry) {
        errors.push(
          `proposed action "${proposed.kind}" is not in the action allowlist`,
        );
        continue;
      }

      // Consequential writes always require explicit confirmation.
      const writeKinds = [
        "log_food",
        "log_workout",
        "record_measurement",
        "adjust_nutrition_target",
        "adjust_training_volume",
        "update_goal",
      ] as const;
      if ((writeKinds as readonly string[]).includes(proposed.kind) && proposed.requiresConfirmation !== true) {
        errors.push(
          `consequential action "${proposed.kind}" must require confirmation`,
        );
      }

      // Proposed action must validate against the current personal context.
      const domainValidation = this.actionRegistry.validateAction(
        proposed.kind,
        proposed.parameters,
        contextSnapshot,
      );
      if (!domainValidation.valid) {
        errors.push(
          `proposed action "${proposed.kind}" failed domain validation: ${domainValidation.errors.join("; ")}`,
        );
      }

      // Evidence cited by the action must trace to supplied evidence.
      for (const ref of proposed.evidenceRefs ?? []) {
        const traced = decisionContext.evidenceRefs.some(
          (d) => d.source === ref.source && d.code === ref.code,
        );
        if (!traced) {
          warnings.push(
            `action "${proposed.kind}" cites evidence ${ref.source}:${ref.code} that is not in the current decision evidence`,
          );
        }
      }

      // Contradiction: proposing a change in a domain governed by the
      // current decision without identifying the existing decision.
      const governed = ACTION_DOMAIN_INTERVENTIONS[proposed.kind] ?? [];
      const conflicts = governed.some((kind) => activeInterventions.has(kind));
      const identifiesDecision =
        currentDecision &&
        (sanitizedAnswer.includes(currentDecision.id) ||
          sanitizedAnswer.includes(currentDecision.kind) ||
          sanitizedAnswer.includes(currentDecision.summary.slice(0, 20)));
      if (conflicts && currentDecision && !identifiesDecision) {
        warnings.push(
          `response proposes a change governed by current decision ${currentDecision.id} (${currentDecision.kind}) without identifying the existing decision`,
        );
      }
    }

    // `no_change` is explicitly allowed: asserting the current plan should
    // stand is never a contradiction.
    if (currentDecision?.kind === "no_change") {
      // No error; the response may affirm no_change.
    }

    // Direct textual contradiction heuristics (secondary to structured checks).
    const lowerAnswer = sanitizedAnswer.toLowerCase();
    if (currentDecision?.kind === "no_change") {
      const contradicts = CONTRADICTION_KEYWORDS.some((k) => lowerAnswer.includes(k));
      if (contradicts && !identifiesAnswerDecision(sanitizedAnswer, currentDecision)) {
        warnings.push(
          "response asserts a change to the current plan while the decision is no_change, without identifying the existing decision",
        );
      }
    }

    // ------------------------------------------------------------------
    // 5. Missing / stale evidence disclosure.
    // ------------------------------------------------------------------
    const quality: ContextQuality = contextSnapshot.quality;
    const qualityWarnings = [
      ...(quality.missingDataWarnings ?? []),
      ...(quality.staleDataWarnings ?? []),
    ];
    for (const w of qualityWarnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }

    if (quality.sufficientForAdvice === false) {
      const expressesUncertainty = /don't (have|know)|not enough|insufficient|unclear|missing|cannot|unable/i.test(
        sanitizedAnswer,
      );
      if (!expressesUncertainty) {
        warnings.push(
          "context is insufficient for substantive advice, but the answer does not disclose the gap",
        );
      }
    }

    // Append disclosed quality warnings to the sanitized answer when they
    // are not already part of it. Nothing invented is added — warnings are
    // derived from the assessed context quality only.
    if (warnings.length > 0 && !sanitizedAnswer.includes("Data quality notes:")) {
      const newWarnings = warnings.filter(
        (w) => !sanitizedAnswer.includes(w),
      );
      if (newWarnings.length > 0) {
        sanitizedAnswer =
          sanitizedAnswer +
          "\n\n---\nData quality notes:\n- " +
          newWarnings.join("\n- ");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedAnswer,
    };
  }
}

/** Whether the answer explicitly identifies the current decision. */
function identifiesAnswerDecision(answer: string, decision: {
  id: string;
  kind: string;
  summary: string;
}): boolean {
  return (
    answer.includes(decision.id) ||
    answer.includes(decision.kind) ||
    answer.includes(decision.summary.slice(0, 20))
  );
}
