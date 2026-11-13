/**
 * AI Provider factory — selects provider based on AI_PROVIDER env var.
 *
 * Supported providers: "mock" (default), "anthropic", "openai"
 * No silent fallbacks — missing API key throws at startup.
 */

import type { AIProvider } from "@fitcoach/ai";
import { createMockProvider } from "@fitcoach/ai";
import { createAnthropicProvider } from "@fitcoach/ai";
import { createOpenAIProvider } from "@fitcoach/ai";

/** Supported AI provider names. */
export type AIProviderName = "mock" | "anthropic" | "openai";

/**
 * Get the configured AI provider name from environment.
 * Defaults to "mock" for development/testing.
 */
export function getAIProviderName(): AIProviderName {
  const name = process.env.AI_PROVIDER?.toLowerCase();
  if (name === "anthropic" || name === "openai" || name === "mock") {
    return name;
  }
  return "mock";
}

/**
 * Create an AI provider instance based on configuration.
 * Throws if the selected provider requires an API key that is not set.
 */
export function createAIProvider(): AIProvider {
  const providerName = getAIProviderName();

  switch (providerName) {
    case "anthropic":
      return createAnthropicProvider();
    case "openai":
      return createOpenAIProvider();
    case "mock":
    default:
      return createMockProvider();
  }
}

/**
 * Create an AI provider by explicit name (for testing/overrides).
 * Throws if the provider requires an API key that is not set.
 */
export function createAIProviderByName(name: AIProviderName): AIProvider {
  switch (name) {
    case "anthropic":
      return createAnthropicProvider();
    case "openai":
      return createOpenAIProvider();
    case "mock":
    default:
      return createMockProvider();
  }
}