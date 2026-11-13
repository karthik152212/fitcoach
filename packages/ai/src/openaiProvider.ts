/**
 * OpenAI (GPT) AI provider implementation.
 *
 * Requires OPENAI_API_KEY environment variable.
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

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-2024-08-06";
const CONTRACT_VERSION = "fitcoach.ai.openai.v1";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  response_format?: { type: "json_object" };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string | null };
    finish_reason: string | null;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
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
  lines.push("RESPONSE FORMAT (JSON):");
  lines.push('{ "answer": "string", "reasoning": "string", "confidence": number, "proposedActions": [], "warnings": [] }');

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
  try {
    const parsed = JSON.parse(raw);
    return {
      answer: parsed.answer ?? "",
      reasoning: parsed.reasoning ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      proposedActions: Array.isArray(parsed.proposedActions) ? parsed.proposedActions : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    // Fallback: try to extract from text
    const answerMatch = raw.match(/"answer"\s*:\s*"([^"]*)"/);
    const reasoningMatch = raw.match(/"reasoning"\s*:\s*"([^"]*)"/);
    const confidenceMatch = raw.match(/"confidence"\s*:\s*([0-9.]+)/);
    const actionsMatch = raw.match(/"proposedActions"\s*:\s*(\[[\s\S]*?\])/);
    const warningsMatch = raw.match(/"warnings"\s*:\s*(\[[\s\S]*?\])/);

    let answer = answerMatch?.[1] ?? "";
    let reasoning = reasoningMatch?.[1] ?? "";
    let confidence = parseFloat(confidenceMatch?.[1] ?? "0.5");
    let proposedActions: unknown[] = [];
    let warnings: string[] = [];

    try {
      if (actionsMatch?.[1]) proposedActions = JSON.parse(actionsMatch[1]);
    } catch {}
    try {
      if (warningsMatch?.[1]) warnings = JSON.parse(warningsMatch[1]);
    } catch {}

    return { answer, reasoning, confidence, proposedActions, warnings };
  }
}

export class OpenAIProvider implements AIProvider {
  readonly metadata: ProviderMetadata = {
    name: "openai",
    isMock: false,
    model: DEFAULT_MODEL,
    contractVersion: CONTRACT_VERSION,
  };

  async generate(request: ProviderRequest): Promise<ProviderResponse | ProviderError> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        code: "provider_not_configured",
        message: "OPENAI_API_KEY not set. Cannot call OpenAI API.",
        retryable: false,
      };
    }

    const systemPrompt = buildSystemPrompt(request.contextSnapshot, request.decisionContext, request.quality);
    const userMessage = buildUserMessage(request);

    const payload: OpenAIRequest = {
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      temperature: 0.3,
      top_p: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    };

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json() as OpenAIErrorResponse;
        return {
          code: "provider_error",
          message: `OpenAI API error (${response.status}): ${errorData.error?.message ?? response.statusText}`,
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      const data = await response.json() as OpenAIResponse;
      const rawText = data.choices[0]?.message?.content ?? "";

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
        message: `Failed to call OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

/**
 * Create an OpenAI provider instance.
 * Throws if OPENAI_API_KEY is not set (fail-fast for production).
 */
export function createOpenAIProvider(): OpenAIProvider {
  if (!getApiKey()) {
    throw new Error("OPENAI_API_KEY not set. Set it in the environment to use the OpenAI provider.");
  }
  return new OpenAIProvider();
}