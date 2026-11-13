/**
 * Deterministic local mock AI provider.
 *
 * This provider exists for development and testing only. It never makes
 * external network calls, requires no API key, and never pretends to be a
 * live AI provider. Outputs are deterministic for equivalent inputs and
 * explicitly labeled as mock.
 *
 * Every fact in the answer is derived solely from the ProviderRequest
 * context — nothing is invented. Where context is absent, the mock says so
 * rather than hallucinating measurements, targets or prescriptions.
 */

import type { AIProvider } from "./provider";
import type {
  PersonalContextSnapshot,
  CoachingDecisionContext,
  ContextQuality,
  ProposedAction,
  ProviderResponse,
} from "./contracts";

const CONTRACT_VERSION = "fitcoach.ai.mock.v1";

function formatNumber(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Number.isFinite(value) ? value.toString() : undefined;
}

function percent(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.toFixed(1) + "%";
}

/** Build an evidence-grounded answer from intent and context. Nothing is invented. */
function buildAnswer(request: {
  coachingRequest: { intent?: { intent: string; confidence: number } };
  contextSnapshot: PersonalContextSnapshot;
  quality: ContextQuality;
}): string {
  const { contextSnapshot: ctx, quality } = request;
  const intent = request.coachingRequest.intent?.intent ?? "general_coaching";
  const lines: string[] = [];

  const training = ctx.training;
  const nutrition = ctx.nutrition;
  const recovery = ctx.recovery;
  const body = ctx.body;
  const decision = ctx.decision;

  const decisionSummary =
    decision?.decisionSnapshot
      ? `Current decision: ${decision.decisionSnapshot.kind} — ${decision.decisionSnapshot.summary} (confidence ${decision.decisionSnapshot.confidence}).`
      : "No current decision on file.";

  switch (intent) {
    case "stalled_progress": {
      lines.push("Here is what your data shows:");
      if (training) {
        lines.push(
          `- Training: ${training.weeklySessionFrequency ?? 0} planned sessions this week; ` +
            `adherence ${percent(training.adherence ?? 0)} of logged sessions completed.`,
        );
        for (const progression of training.progressionStatus ?? []) {
          lines.push(
            `- ${progression.exerciseName ?? progression.exerciseId}: ${progression.status} ` +
              `(current ${formatNumber(progression.currentLoadKg)}kg, ${progression.progressionsCompleted} progressions completed).`,
          );
        }
        for (const plateau of training.plateauSignals ?? []) {
          lines.push(`- Plateau signal: ${plateau.observation} (${plateau.kind}).`);
        }
      }
      if (nutrition) {
        lines.push(
          `- Nutrition: protein ${formatNumber(nutrition.adherence?.proteinPercent)}% of target; ` +
            `calories ${percent(nutrition.adherence?.caloriesPercent)} of target.`,
        );
      }
      if (recovery) {
        lines.push(
          `- Recovery: readiness ${formatNumber(recovery.readinessScore)}/100; ` +
            `fatigue ${recovery.fatigueAccumulation ?? "unknown"}.`,
        );
      }
      if (body) {
        lines.push(
          `- Body: latest weight ${formatNumber(body.latestWeightKg)}kg; ` +
            `measurements on file: ${body.measurementsCount}.`,
        );
      }
      lines.push(decisionSummary);
      break;
    }

    case "todays_workout": {
      if (training) {
        lines.push("Your training plan has sessions this week:");
        for (const session of training.plannedSessions ?? []) {
          const slotSummary = (session.slots ?? [])
            .map((slot) => {
              const name = slot.exerciseName ?? slot.exerciseId;
              const reps = slot.targetRepRange
                ? `${slot.targetRepRange.min}-${slot.targetRepRange.max} reps`
                : "reps not set";
              return `${name} ${slot.targetSets ?? 0}×${reps}`;
            })
            .join("; ");
          lines.push(`- ${session.name}: ${slotSummary}`);
        }
        lines.push(
          `Adherence: ${percent(training.adherence ?? 0)} of planned sessions completed.`,
        );
        lines.push(
          "I do not prescribe specific sets, reps or load — your plan does that. " +
            "Follow the targets above.",
        );
      } else {
        lines.push("No active training plan is on file, so I can't tell you what's scheduled today.");
      }
      if (recovery) {
        lines.push(
          `- Recovery check: readiness ${formatNumber(recovery.readinessScore)}/100, ` +
            `sleep ${recovery.sleepAdequacy ?? "unknown"}, fatigue ${recovery.fatigueAccumulation ?? "unknown"}.`,
        );
        if (
          (recovery.readinessScore ?? 100) < 70 ||
          recovery.sleepAdequacy === "severe_debt" ||
          recovery.fatigueAccumulation === "high"
        ) {
          lines.push("Recovery is borderline today — consider an easier session or rest, and log how you feel.");
        }
      }
      lines.push(decisionSummary);
      break;
    }

    case "nutrition_question": {
      if (nutrition) {
        const daily = (nutrition.dailyNutrition ?? []).slice(-7);
        if (daily.length > 0) {
          const avgCalories =
            daily.reduce((sum, d) => sum + d.totals.caloriesKcal, 0) / daily.length;
          const avgProtein =
            daily.reduce((sum, d) => sum + d.totals.proteinGrams, 0) / daily.length;
          lines.push(
            `- Over the last ${daily.length} logged days: average ${avgCalories.toFixed(0)}kcal ` +
              `and ${avgProtein.toFixed(0)}g protein per day.`,
          );
        }
        if (nutrition.targets) {
          lines.push(
            `- Targets: ${nutrition.targets.caloriesKcal}kcal and ${nutrition.targets.proteinGrams}g protein. ` +
              `Do not treat these as changed unless a decision updates them.`,
          );
        }
        if (nutrition.adherence) {
          lines.push(
            `- Adherence: protein ${percent(nutrition.adherence.proteinPercent)}%, ` +
              `calories ${percent(nutrition.adherence.caloriesPercent)}%.`,
          );
        }
      } else {
        lines.push("No nutrition data is on file yet.");
      }
      if (decision?.activeInterventions?.includes("nutrition_target_adjustment")) {
        lines.push("- An active nutrition_target_adjustment intervention exists in your current decision.");
      }
      break;
    }

    case "weight_physique": {
      if (body) {
        lines.push(
          `- Latest weight: ${formatNumber(body.latestWeightKg)}kg ` +
            `(${body.measurementsCount} measurements on file).`,
        );
        if (body.weightTrend28d !== undefined) {
          lines.push(`- 28-day weight trend: ${body.weightTrend28d > 0 ? "+" : ""}${body.weightTrend28d.toFixed(2)}kg.`);
        }
        if (body.weightTrend7d !== undefined) {
          lines.push(`- 7-day weight trend: ${body.weightTrend7d > 0 ? "+" : ""}${body.weightTrend7d.toFixed(2)}kg.`);
        }
      } else {
        lines.push("No body measurements are on file yet.");
      }
      if (ctx.goal?.physiqueTarget?.bodyWeightKg !== undefined) {
        lines.push(
          `- Physique goal target: ${ctx.goal.physiqueTarget.bodyWeightKg}kg.`,
        );
      }
      if (ctx.goal?.effectiveFrom) {
        lines.push(`- Goal effective from: ${ctx.goal.effectiveFrom}.`);
      }
      // Surface any projection evidence carried by the current decision so the
      // answer never silently omits a projection the Decision Brain already
      // computed. Do not invent a date or target — only restate what's there.
      const projectionEvidence = decision?.evidenceRefs?.filter(
        (ref) => ref.source === "projection_state",
      );
      if (projectionEvidence?.length) {
        for (const ref of projectionEvidence) {
          lines.push(`- Projection: ${ref.value} — ${ref.title}.`);
        }
        lines.push(
          "Projections are estimates, not promises — treat any trajectory as uncertain.",
        );
      } else {
        lines.push(
          "No projection snapshot is available from the connected data sources, so I can't quote an expected weight at a future date.",
        );
        lines.push("Projections are estimates, not promises — treat any trajectory as uncertain.");
      }
      lines.push(decisionSummary);
      break;
    }

    case "follow_up": {
      lines.push("Building on our previous turn:");
      const evidenceRefs = decision?.evidenceRefs ?? [];
      if (evidenceRefs.length > 0) {
        lines.push("- The evidence we discussed still stands:");
        for (const ref of evidenceRefs.slice(0, 3)) {
          lines.push(`  - ${ref.basis}`);
        }
      }
      if (training) {
        lines.push(`- Training adherence remains ${percent(training.adherence ?? 0)}.`);
      }
      lines.push(decisionSummary);
      break;
    }

    case "recovery_readiness": {
      if (recovery) {
        lines.push(
          `- Readiness: ${formatNumber(recovery.readinessScore)}/100; ` +
            `fatigue: ${recovery.fatigueAccumulation ?? "unknown"}; ` +
            `sleep: ${recovery.sleepAdequacy ?? "unknown"}.`,
        );
        if (recovery.trainingRecommendation) {
          lines.push(`- Guidance: ${recovery.trainingRecommendation}.`);
        }
      } else {
        lines.push("No recovery data is on file yet.");
      }
      break;
    }

    default: {
      lines.push("Here is a summary of your available FitCoach data:");
      if (ctx.profile?.profile) {
        lines.push(`- Profile: ${ctx.profile.profile.trainingExperience ?? "unknown"} experience, ` +
          `${ctx.profile.profile.trainingDaysPerWeek ?? 0} training days/week.`);
      }
      if (ctx.goal) {
        lines.push(`- Goal: ${ctx.goal.kind ?? "unset"} (${ctx.goal.priorities?.join(", ") ?? "no priorities"}).`);
      }
      if (training) {
        lines.push(`- Training: ${percent(training.adherence ?? 0)} session adherence.`);
      }
      if (nutrition) {
        lines.push(`- Nutrition: protein ${percent(nutrition.adherence?.proteinPercent)}% of target.`);
      }
      if (recovery) {
        lines.push(`- Recovery: readiness ${formatNumber(recovery.readinessScore)}/100.`);
      }
      if (body) {
        lines.push(`- Body: latest weight ${formatNumber(body.latestWeightKg)}kg.`);
      }
      lines.push(decisionSummary);
      break;
    }
  }

  const evidenceRefs = decision?.evidenceRefs ?? [];
  if (evidenceRefs.length > 0) {
    lines.push("");
    lines.push("Based on your current evidence:");
    for (const ref of evidenceRefs.slice(0, 3)) {
      lines.push(`- ${ref.basis}`);
    }
  }

  if (quality.staleDataWarnings.length > 0) {
    lines.push("");
    lines.push("Data freshness warnings:");
    for (const warning of quality.staleDataWarnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

function buildMockResponse(request: {
  contextSnapshot: PersonalContextSnapshot;
  quality: ContextQuality;
  coachingRequest: { intent?: { intent: string; confidence: number } };
}): ProviderResponse {
  const { contextSnapshot, quality, coachingRequest } = request;

  const answerLines: string[] = [];

  // Always disclose mock status explicitly.
  answerLines.push("[Mock AI response]");

  // Address missing context first.
  if (!quality.sufficientForAdvice) {
    answerLines.push(
      "I don't have enough information about your situation to give a useful answer.",
    );
    if (quality.missingDataWarnings.length > 0) {
      answerLines.push("Missing data:");
      for (const warning of quality.missingDataWarnings) {
        answerLines.push(`- ${warning}`);
      }
    }
    if (quality.recommendedFollowUpQuestions.length > 0) {
      answerLines.push("To help me answer, could you tell me:");
      for (const question of quality.recommendedFollowUpQuestions) {
        answerLines.push(`- ${question}`);
      }
    }
    return {
      answer: answerLines.join("\n"),
      reasoningTrace: [
        "Sufficient advice: false",
        "Missing data warnings: " + quality.missingDataWarnings.join("; "),
      ],
      isMock: true,
    };
  }

  answerLines.push(buildAnswer({ coachingRequest, contextSnapshot, quality }));

  // Propose actions based on what's available, always gated behind confirmation.
  const proposedActions: ProposedAction[] = [];
  if (contextSnapshot.nutrition?.adherence) {
    const firstDaily = contextSnapshot.nutrition.dailyNutrition?.[0];
    proposedActions.push({
      id: "mock_action_log_food",
      kind: "log_food",
      title: "Log today's meals",
      description: "Record what you've eaten so I can assess nutrition adherence.",
      domainService: "nutrition.createMeal",
      parameters: {
        localDate: contextSnapshot.asOf,
        clientRequestId: "mock_action_log_food",
        items: [
          {
            foodId: "mock_food_1",
            quantityGrams: 100,
            computedNutrients: firstDaily
              ? {
                  caloriesKcal: firstDaily.totals.caloriesKcal,
                  proteinGrams: firstDaily.totals.proteinGrams,
                  carbohydrateGrams: firstDaily.totals.carbohydrateGrams,
                  fatGrams: firstDaily.totals.fatGrams,
                }
              : { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
            confidence: "estimated",
            notes: "Mock-proposed meal; confirm before logging",
          },
        ],
      } as unknown as Record<string, string | number | boolean | null>,
      requiresConfirmation: true,
      validated: true,
      evidenceRefs: [],
      status: "pending",
    });
  }

  return {
    answer: answerLines.join("\n"),
    reasoningTrace: [
      "Context sources: " + contextSnapshot.sources.map((s) => s.source).join(", "),
      "Overall quality: " + quality.overallScore + "/100",
    ],
    confidence: quality.overallScore / 100,
    proposedActions,
    warnings: quality.staleDataWarnings,
    isMock: true,
  };
}

/**
 * Deterministic local mock AI provider for development and testing.
 */
export class MockAIProvider implements AIProvider {
  readonly metadata = {
    name: "mock",
    isMock: true,
    model: "mock-local",
    contractVersion: CONTRACT_VERSION,
  };

  async generate(_request: {
    coachingRequest: unknown;
    systemPrompt: string;
    contextSnapshot: PersonalContextSnapshot;
    decisionContext: CoachingDecisionContext;
    quality: ContextQuality;
  }): Promise<ProviderResponse> {
    // Deterministic: same input always produces same output structure.
    // No external calls, no randomness, no API key.
    return buildMockResponse({
      contextSnapshot: _request.contextSnapshot,
      quality: _request.quality,
      coachingRequest: _request.coachingRequest as { intent?: { intent: string; confidence: number } },
    });
  }
}

/**
 * Create a mock provider instance.
 */
export function createMockProvider(): MockAIProvider {
  return new MockAIProvider();
}
