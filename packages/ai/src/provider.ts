/**
 * AI provider interface.
 *
 * Imports provider-independent boundary types from contracts.ts and adds
 * the AIProvider interface. No external provider SDK types appear here — the
 * boundary is deliberately provider-independent.
 */

import type {
  CoachingRequest,
  PersonalContextSnapshot,
  CoachingDecisionContext,
  ContextQuality,
  ProviderResponse,
  ProviderError,
  ProviderMetadata,
} from "./contracts";

/**
 * The AI provider interface.
 */
export interface AIProvider {
  /** Provider metadata. */
  readonly metadata: ProviderMetadata;
  /**
   * Generate a coaching response from a structured request.
   * Never throws for expected failures — returns ProviderError instead.
   */
  generate(request: {
    coachingRequest: CoachingRequest;
    systemPrompt: string;
    contextSnapshot: PersonalContextSnapshot;
    decisionContext: CoachingDecisionContext;
    quality: ContextQuality;
  }): Promise<ProviderResponse | ProviderError>;
}
