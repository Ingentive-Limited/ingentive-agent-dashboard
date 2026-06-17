import { describe, it, expect } from "vitest";
import {
  pricingForModel,
  ANTHROPIC_PRICING,
  OPENAI_PRICING,
  copilotMultiplier,
  costForCopilotRequests,
  COPILOT_OVER_QUOTA_RATE_USD,
} from "@/lib/pricing";

/**
 * The published constants are in USD/1M tokens; `pricingForModel` divides by
 * 1M so callers can multiply by raw token counts. These tests assert exact
 * matches, prefix-fallback behaviour, and provider defaults.
 */

describe("pricingForModel", () => {
  it("matches an exact Anthropic model id", () => {
    const p = pricingForModel("claude-opus-4", "claude");
    expect(p.input).toBeCloseTo(15 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(75 / 1_000_000, 12);
    expect(p.cacheWrite).toBeCloseTo(18.75 / 1_000_000, 12);
    expect(p.cacheRead).toBeCloseTo(1.5 / 1_000_000, 12);
  });

  it("matches a prefix for unknown Anthropic Sonnet variants", () => {
    const p = pricingForModel("claude-sonnet-4-8", "claude");
    // Falls back to Sonnet 4 rates by prefix
    expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(15 / 1_000_000, 12);
  });

  it("matches a prefix for unknown Anthropic Opus variants", () => {
    const p = pricingForModel("claude-opus-4-7", "claude");
    expect(p.input).toBeCloseTo(15 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(75 / 1_000_000, 12);
  });

  it("matches an exact Anthropic Haiku model", () => {
    const p = pricingForModel("claude-haiku-4", "claude");
    expect(p.input).toBeCloseTo(0.8 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(4 / 1_000_000, 12);
  });

  it("falls back to Sonnet 4 when the Anthropic model is unknown", () => {
    const p = pricingForModel("totally-unknown-model", "claude");
    expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(15 / 1_000_000, 12);
  });

  it("falls back to Sonnet 4 when the model is null/undefined for claude", () => {
    const a = pricingForModel(null, "claude");
    const b = pricingForModel(undefined, "claude");
    const c = pricingForModel("", "claude");
    for (const p of [a, b, c]) {
      expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
      expect(p.output).toBeCloseTo(15 / 1_000_000, 12);
    }
  });

  it("uses Sonnet 4 fallback for the cowork provider as well", () => {
    const p = pricingForModel(null, "cowork");
    expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
  });

  it("matches an exact OpenAI Codex model", () => {
    const p = pricingForModel("gpt-5.3-codex", "codex");
    expect(p.input).toBeCloseTo(2 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(8 / 1_000_000, 12);
    expect(p.reasoning).toBeCloseTo(8 / 1_000_000, 12);
  });

  it("matches an exact OpenAI gpt-5.4-mini model with much cheaper rates", () => {
    const p = pricingForModel("gpt-5.4-mini", "codex");
    expect(p.input).toBeCloseTo(0.25 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(1 / 1_000_000, 12);
    expect(p.reasoning).toBeCloseTo(1 / 1_000_000, 12);
  });

  it("matches gpt-5.4 separately from gpt-5.4-mini", () => {
    const p = pricingForModel("gpt-5.4", "codex");
    expect(p.input).toBeCloseTo(2.5 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(10 / 1_000_000, 12);
  });

  it("disambiguates gpt-5.4-mini from gpt-5.4 via prefix order", () => {
    // Hypothetical "gpt-5.4-mini-preview" — must still pick the mini bucket.
    const p = pricingForModel("gpt-5.4-mini-preview", "codex");
    expect(p.input).toBeCloseTo(0.25 / 1_000_000, 12);
  });

  it("falls back to gpt-5.3-codex when the Codex model is unknown", () => {
    const p = pricingForModel("some-future-codex", "codex");
    expect(p.input).toBeCloseTo(2 / 1_000_000, 12);
    expect(p.reasoning).toBeCloseTo(8 / 1_000_000, 12);
  });

  it("falls back to gpt-5.3-codex when the codex model is null", () => {
    const p = pricingForModel(null, "codex");
    expect(p.input).toBeCloseTo(2 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(8 / 1_000_000, 12);
  });

  it("normalises dotted Scout model ids to the same family as dashed ones", () => {
    // Scout emits dotted ids ("claude-opus-4.7"); Claude Code/Codex use dashes
    // ("claude-opus-4-7"). Both must resolve to the same Opus 4 rate sheet.
    const dotted = pricingForModel("claude-opus-4.7", "scout");
    const dashed = pricingForModel("claude-opus-4-7", "claude");
    expect(dotted.input).toBeCloseTo(dashed.input, 12);
    expect(dotted.output).toBeCloseTo(dashed.output, 12);
    expect(dotted.cacheWrite).toBeCloseTo(dashed.cacheWrite, 12);
    expect(dotted.cacheRead).toBeCloseTo(dashed.cacheRead, 12);
  });

  it("resolves Scout Sonnet ids (dotted) to Sonnet 4 rates", () => {
    const p = pricingForModel("claude-sonnet-4.5", "scout");
    expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(15 / 1_000_000, 12);
  });

  it("routes Scout GPT-family models through OpenAI pricing", () => {
    // A hypothetical Scout session whose user switched to a GPT-5.4 model:
    // even though provider is "scout", the prefix should pull OpenAI rates.
    const p = pricingForModel("gpt-5.4", "scout");
    expect(p.input).toBeCloseTo(2.5 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(10 / 1_000_000, 12);
  });

  it("falls back to Sonnet 4 for Scout when the model is unknown", () => {
    const p = pricingForModel(null, "scout");
    expect(p.input).toBeCloseTo(3 / 1_000_000, 12);
    expect(p.output).toBeCloseTo(15 / 1_000_000, 12);
  });

  it("publishes anthropic and openai pricing tables", () => {
    expect(ANTHROPIC_PRICING["claude-opus-4"].output).toBe(75);
    expect(ANTHROPIC_PRICING["claude-sonnet-4"].output).toBe(15);
    expect(OPENAI_PRICING["gpt-5.4-mini"].output).toBe(1);
  });
});

describe("GitHub Copilot premium-request pricing", () => {
  it("uses 10x multiplier for Claude Opus", () => {
    expect(copilotMultiplier("claude-opus-4.7")).toBe(10);
    expect(copilotMultiplier("claude-opus-4-7")).toBe(10);
    expect(copilotMultiplier("claude-opus-4")).toBe(10);
  });

  it("uses 1x multiplier for Claude Sonnet", () => {
    expect(copilotMultiplier("claude-sonnet-4-6")).toBe(1);
    expect(copilotMultiplier("claude-sonnet-3.5")).toBe(1);
  });

  it("uses 0.25x multiplier for Claude Haiku", () => {
    expect(copilotMultiplier("claude-haiku-4-5")).toBe(0.25);
  });

  it("normalises dotted model ids", () => {
    // Scout writes "claude-opus-4.7"; pricing table keys use dashes.
    expect(copilotMultiplier("claude-opus-4.7")).toBe(10);
    expect(copilotMultiplier("claude-sonnet-4.6")).toBe(1);
  });

  it("falls back to 1x for unknown models", () => {
    expect(copilotMultiplier(null)).toBe(1);
    expect(copilotMultiplier(undefined)).toBe(1);
    expect(copilotMultiplier("")).toBe(1);
    expect(copilotMultiplier("something-weird")).toBe(1);
  });

  it("computes over-quota cost as count × multiplier × $0.04", () => {
    // 1 Opus 4.7 request = 10 × $0.04 = $0.40
    expect(costForCopilotRequests("claude-opus-4.7", 1)).toBeCloseTo(0.4, 12);
    // 20 Opus requests = 20 × 10 × $0.04 = $8
    expect(costForCopilotRequests("claude-opus-4.7", 20)).toBeCloseTo(8.0, 12);
    // 5 Sonnet requests = 5 × 1 × $0.04 = $0.20
    expect(costForCopilotRequests("claude-sonnet-4.6", 5)).toBeCloseTo(0.2, 12);
    // 100 Haiku requests = 100 × 0.25 × $0.04 = $1.00
    expect(costForCopilotRequests("claude-haiku-4-5", 100)).toBeCloseTo(1.0, 12);
  });

  it("returns 0 for zero / negative / non-finite counts", () => {
    expect(costForCopilotRequests("claude-opus-4.7", 0)).toBe(0);
    expect(costForCopilotRequests("claude-opus-4.7", -5)).toBe(0);
    expect(costForCopilotRequests("claude-opus-4.7", NaN)).toBe(0);
  });

  it("exposes the over-quota retail rate constant", () => {
    expect(COPILOT_OVER_QUOTA_RATE_USD).toBe(0.04);
  });
});
