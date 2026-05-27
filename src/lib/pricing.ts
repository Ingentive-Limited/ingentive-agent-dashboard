/**
 * Per-model pricing tables.
 *
 * All published rates are in USD per 1M tokens. Because the existing
 * `calculateCost` helper multiplies pricing by *per-token* counts, the
 * `pricingForModel` helper returns rates divided by 1_000_000 so callers can
 * plug the result straight into `calculateCost`.
 *
 * Coverage targets the models that actually show up in real Cowork/Claude/Codex
 * session data; unknown models fall back to a per-provider default that
 * matches what we used to hardcode (Sonnet 4 for Anthropic, gpt-5.3-codex for
 * OpenAI). That way an older session lacking a `model` field is priced exactly
 * the same as it was before this change — no surprise regressions.
 */
import type { PricingConfig } from "./utils-server";

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-creation tokens (Anthropic-style cache writes). */
  cacheWrite: number;
  /** USD per 1M cache-read tokens. */
  cacheRead: number;
  /** USD per 1M reasoning tokens (OpenAI o-series / gpt-5 reasoning models). */
  reasoning?: number;
}

/** Anthropic published list pricing — keyed by canonical model id stem. */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Opus 4.x
  "claude-opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  // Sonnet 4.x (used as Anthropic fallback)
  "claude-sonnet-4": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  // Haiku 4.x
  "claude-haiku-4": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

/** OpenAI published list pricing — keyed by canonical model id stem. */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-5.3-codex": { input: 2, output: 8, cacheWrite: 0, cacheRead: 0, reasoning: 8 },
  "gpt-5.4-mini": { input: 0.25, output: 1, cacheWrite: 0, cacheRead: 0, reasoning: 1 },
  "gpt-5.4": { input: 2.5, output: 10, cacheWrite: 0, cacheRead: 0, reasoning: 10 },
};

/** Provider-default model when nothing matches. */
const ANTHROPIC_DEFAULT_KEY = "claude-sonnet-4";
const OPENAI_DEFAULT_KEY = "gpt-5.3-codex";

/**
 * Normalize per-1M USD pricing into per-token rates compatible with
 * `calculateCost` in utils-server.ts.
 */
function perToken(p: ModelPricing): PricingConfig {
  return {
    input: p.input / 1_000_000,
    output: p.output / 1_000_000,
    cacheWrite: p.cacheWrite / 1_000_000,
    cacheRead: p.cacheRead / 1_000_000,
    reasoning: p.reasoning != null ? p.reasoning / 1_000_000 : undefined,
  };
}

function lookupAnthropic(model: string): ModelPricing | undefined {
  // Exact match first (e.g. "claude-opus-4-7")
  if (ANTHROPIC_PRICING[model]) return ANTHROPIC_PRICING[model];
  // Prefix match by family stem (e.g. "claude-opus-4-7" → "claude-opus-4")
  const lower = model.toLowerCase();
  if (lower.startsWith("claude-opus")) return ANTHROPIC_PRICING["claude-opus-4"];
  if (lower.startsWith("claude-sonnet")) return ANTHROPIC_PRICING["claude-sonnet-4"];
  if (lower.startsWith("claude-haiku")) return ANTHROPIC_PRICING["claude-haiku-4"];
  return undefined;
}

function lookupOpenAI(model: string): ModelPricing | undefined {
  if (OPENAI_PRICING[model]) return OPENAI_PRICING[model];
  const lower = model.toLowerCase();
  // Order matters: longest/most-specific stems first so "gpt-5.4-mini" doesn't
  // get swallowed by a "gpt-5.4" prefix check.
  if (lower.startsWith("gpt-5.4-mini")) return OPENAI_PRICING["gpt-5.4-mini"];
  if (lower.startsWith("gpt-5.4")) return OPENAI_PRICING["gpt-5.4"];
  if (lower.startsWith("gpt-5.3-codex") || lower.startsWith("gpt-5.3")) {
    return OPENAI_PRICING["gpt-5.3-codex"];
  }
  if (lower.startsWith("codex")) return OPENAI_PRICING["gpt-5.3-codex"];
  return undefined;
}

/**
 * Resolve the per-token pricing for a session's model.
 *
 * - `null`/`undefined`/unknown model → provider default (Sonnet 4 for
 *   claude/cowork, gpt-5.3-codex for codex).
 * - Exact model id match takes priority over a family-prefix match.
 */
export function pricingForModel(
  model: string | null | undefined,
  provider: "claude" | "codex" | "cowork"
): PricingConfig {
  const isAnthropicProvider = provider === "claude" || provider === "cowork";

  if (model && typeof model === "string" && model.trim()) {
    const m = model.trim();
    if (isAnthropicProvider) {
      const hit = lookupAnthropic(m);
      if (hit) return perToken(hit);
    } else {
      const hit = lookupOpenAI(m);
      if (hit) return perToken(hit);
    }
  }

  // Fallback — provider default.
  const defaultPricing = isAnthropicProvider
    ? ANTHROPIC_PRICING[ANTHROPIC_DEFAULT_KEY]
    : OPENAI_PRICING[OPENAI_DEFAULT_KEY];
  return perToken(defaultPricing);
}
