/**
 * AI Coach services barrel export.
 *
 * Phase 9.2 — Personal Context Builder & Evidence Intelligence.
 * Phase 9.3 — Conversation Orchestrator, Response Validator, Typed Action
 * Registry and the mock AI provider (no API key, no network access).
 */

export {
  PersonalContextBuilder,
  DEFAULT_CONTEXT_BUILDER_CONFIG,
  type ContextBuilderConfig,
} from "./contextBuilder";
export {
  ConversationOrchestrator,
  CoachingError,
  type CoachingRequest,
  type OrchestratorDependencies,
} from "./orchestrator";
export {
  ResponseValidator,
  type ResponseValidationInput,
} from "./responseValidator";
export {
  TypedActionRegistry,
  makeProposedAction,
  type ActionPreview,
  type PendingActionRecord,
  type ActionExecutionResult,
  ALLOWLISTED_ACTION_KINDS,
  actionRequiresConfirmation,
} from "./actionRegistry";
export { createMockProvider, MockAIProvider } from "@fitcoach/ai";
