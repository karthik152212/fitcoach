/**
 * Anthropic (Claude) AI provider implementation.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * No silent fallbacks — if the key is missing or the call fails, the error is returned.
 */

import type { AIProvider } from "./provider";
import type {
  ProviderRequest,
  ProviderResponse,
  ProviderError,
  ProviderMetadata,
  PersonalContextSnapshot,
  CoachingDecisionContext,
  ContextQuality,
} from "./contracts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const CONTRACT_VERSION = "fitcoach.ai.anthropic.v1";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  temperature?: number;
  top_p?: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: "assistant";
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

function buildSystemPrompt(context: PersonalContextSnapshot, decision: CoachingDecisionContext, quality: ContextQuality): string {
  const lines: string[] = [
    "You are the FitCoach AI Coach. Your role is to provide evidence-grounded coaching responses.",
    "",
    "RULES:",
    "1. NEVER invent facts. Every claim must trace to the provided context.",
    "2. If context is missing for a question, say so and ask for clarification.",
    "3. Do not prescribe medical advice. Defer to healthcare professionals for injuries/conditions.",
    "4. Training prescriptions (sets, reps, load) come from the user's plan — do not override.",
    "5. Nutrition targets come from active decisions — do not invent new targets.",
    "6. Projections are estimates, not promises. Always label them as such.",
    "7. When proposing actions, they must be confirmable by the user before execution.",
    "",
    "CONTEXT SUMMARY:",
  ];

  if (context.profile?.profile) {
    const p = context.profile.profile;
    lines.push(`- Profile: ${p.trainingExperience ?? "unknown"} experience, ${p.trainingDaysPerWeek ?? 0} days/week, ${p.sex ?? "unknown"}, ${p.heightCm ?? "unknown"}cm`);
  }

  if (context.goal) {
    lines.push(`- Goal: ${context.goal.kind ?? "unset"}${context.goal.physiqueTarget?.bodyWeightKg ? `, target ${context.goal.physiqueTarget.bodyWeightKg}kg` : ""}`);
  }

  if (context.training) {
    const t = context.training;
    lines.push(`- Training: ${t.weeklySessionFrequency ?? 0} sessions/week, adherence ${(t.adherence ?? 0).toFixed(0)}%`);
    if (t.plateauSignals?.length) {
      lines.push(`  Plateau signals: ${t.plateauSignals.map(s => s.kind).join(", ")}`);
    }
  }

  if (context.nutrition) {
    const n = context.nutrition;
    lines.push(`- Nutrition: protein ${n.adherence?.proteinPercent?.toFixed(0) ?? "??"}% of target, calories ${n.adherence?.caloriesPercent?.toFixed(0) ?? "??"}%`);
    if (n.targets) {
      lines.push(`  Targets: ${n.targets.caloriesKcal}kcal, ${n.targets.proteinGrams}g protein`);
    }
  }

  if (context.recovery) {
    const r = context.recovery;
    lines.push(`- Recovery: readiness ${r.readinessScore ?? "??"}/100, fatigue ${r.fatigueAccumulation ?? "unknown"}, sleep ${r.sleepAdequacy ?? "unknown"}`);
    if (r.trainingRecommendation) lines.push(`  Guidance: ${r.trainingRecommendation}`);
  }

  if (context.body) {
    const b = context.body;
    lines.push(`- Body: latest weight ${b.latestWeightKg ?? "??"}kg, trend 7d ${b.weightTrend7d ?? "??"}kg, 28d ${b.weightTrend28d ?? "??"}kg`);
  }

  if (decision.decisionSnapshot) {
    lines.push(`- Current Decision: ${decision.decisionSnapshot.kind} — ${decision.decisionSnapshot.summary} (confidence ${decision.decisionSnapshot.confidence})`);
  }

  if (decision.activeInterventions?.length) {
    lines.push(`- Active Interventions: ${decision.activeInterventions.join(", ")}`);
  }

  if (quality.missingDataWarnings.length) {
    lines.push(`- Missing Data: ${quality.missingDataWarnings.join("; ")}`);
  }

  if (quality.staleDataWarnings.length) {
    lines.push(`- Stale Data: ${quality.staleDataWarnings.join("; ")}`);
  }

  if (!quality.sufficientForAdvice) {
    lines.push("- INSUFFICIENT DATA FOR SUBSTANTIVE ADVICE — must ask clarifying questions");
  }

  lines.push("");
  lines.push("FORMAT YOUR RESPONSE AS:");
  lines.push("ANSWER: <your natural language response to the user>");
  lines.push("REASONING: <brief trace of how context led to answer>");
  lines.push("CONFIDENCE: <0-1>");
  lines.push("PROPOSED_ACTIONS: <JSON array of proposed actions, or empty array>");
  lines.push("WARNINGS: <JSON array of warnings, or empty array>");

  return lines.join("\n");
}

function buildUserMessage(request: ProviderRequest): string {
  const { coachingRequest, contextSnapshot } = request;

  let msg = `User message: "${coachingRequest.message}"\n`;

  if (coachingRequest.intent) {
    msg += `Classified intent: ${coachingRequest.intent.intent} (confidence ${coachingRequest.intent.confidence})\n`;
  }

  msg += `Context anchored to: ${contextSnapshot.asOf}\n`;

  if (contextSnapshot.conversation) {
    msg += "\nRecent conversation:\n";
    for (const m of contextSnapshot.conversation.messages.slice(0, 5)) {
      msg += `${m.role}: ${m.content}\n`;
    }
  }

  return msg;
}

function parseProviderResponse(raw: string): {
  answer: string;
  reasoning: string;
  confidence: number;
  proposedActions: unknown[];
  warnings: string[];
} {
  const answerMatch = raw.match(/ANSWER:\s*([\s\S]*?)(?:\nREASONING:|$)/);
  const reasoningMatch = raw.match(/REASONING:\s*([\s\S]*?)(?:\nCONFIDENCE:|$)/);
  const confidenceMatch = raw.match(/CONFIDENCE:\s*([\s\S]*?)(?:\nPROPOSED_ACTIONS:|$)/);
  const actionsMatch = raw.match(/PROPOSED_ACTIONS:\s*([\s\S]*?)(?:\nWARNINGS:|$)/);
  const warningsMatch = raw.match(/WARNINGS:\s*([\s\S]*?)(?:\n|$)/);

  let answer = answerMatch?.[1]?.trim() ?? "";
  let reasoning = reasoningMatch?.[1]?.trim() ?? "";
  let confidence = parseFloat(confidenceMatch?.[1]?.trim() ?? "0.5");
  let proposedActions: unknown[] = [];
  let warnings: string[] = [];

  try {
    if (actionsMatch?.[1]) {
      proposedActions = JSON.parse(actionsMatch[1].trim());
    }
  } catch {
    proposedActions = [];
  }

  try {
    if (warningsMatch?.[1]) {
      warnings = JSON.parse(warningsMatch[1].trim());
    }
  } catch {
    warnings = [];
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0.5;
  }

  return { answer, reasoning, confidence, proposedActions, warnings };
}

export class AnthropicAIProvider implements AIProvider {
  readonly metadata: ProviderMetadata = {
    name: "anthropic",
    isMock: false,
    model: DEFAULT_MODEL,
    contractVersion: CONTRACT_VERSION,
  };

  async generate(request: ProviderRequest): Promise<ProviderResponse | ProviderError> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        code: "provider_not_configured",
        message: "ANTHROPIC_API_KEY not set. Cannot call Anthropic API.",
        retryable: false,
      };
    }

    const systemPrompt = buildSystemPrompt(request.contextSnapshot, request.decisionContext, request.quality);
    const userMessage = buildUserMessage(request);

    const payload: AnthropicRequest = {
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      top_p: 0.9,
    };

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json() as AnthropicErrorResponse;
        return {
          code: "provider_error",
          message: `Anthropic API error (${response.status}): ${errorData.error?.message ?? response.statusText}`,
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      const data = await response.json() as AnthropicResponse;
      const rawText = data.content.map(c => c.text).join("");

      const parsed = parseProviderResponse(rawText);

      return {
        answer: parsed.answer,
        reasoningTrace: parsed.reasoning ? [parsed.reasoning] : [],
        confidence: parsed.confidence,
        proposedActions: parsed.proposedActions as ProviderResponse["proposedActions"],
        warnings: parsed.warnings,
        isMock: false,
        rawResponse: { id: data.id, model: data.model, usage: data.usage },
      };
    } catch (error) {
      return {
        code: "network_error",
        message: `Failed to call Anthropic API: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

/**
 * Create an Anthropic provider instance.
 * Throws if ANTHROPIC_API_KEY is not set (fail-fast for production).
 */
export function createAnthropicProvider(): AnthropicAIProvider {
  if (!getApiKey()) {
    throw new Error("ANTHROPIC_API_KEY not set. Set it in the environment to use the Anthropic provider.");
  }
  return new AnthropicAIProvider();
}