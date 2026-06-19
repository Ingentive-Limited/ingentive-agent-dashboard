import { describe, it, expect } from "vitest";
import {
  parseMultiplierFromDetails,
  parseModelFromDetails,
  normaliseCopilotUsage,
  tokensFromCopilotEvents,
  statusFromCopilotState,
} from "@/lib/copilot-data";

/**
 * Fixtures mirror the on-disk shape of a VS Code Copilot Chat JSONL:
 * a `{kind:0, v:...}` header followed by `{kind:1, k:[...], v:...}` mutation
 * events. A completed assistant turn is `{kind:1, k:["requests", N, "result"],
 * v:{ usage, details, metadata, ... }}` where `details` carries the model
 * name AND the premium-request multiplier inline ("Claude Opus 4.7 • 10x").
 */

function header(opts: { modelName?: string; modeId?: string } = {}) {
  return {
    kind: 0,
    v: {
      version: 3,
      creationDate: 1774036356624,
      initialLocation: "panel",
      responderUsername: "GitHub Copilot",
      sessionId: "test-session",
      inputState: {
        mode: { id: opts.modeId ?? "agent", kind: "agent" },
        selectedModel: {
          identifier: "copilot/auto",
          name: opts.modelName ?? "Auto",
          metadata: { name: opts.modelName ?? "Auto" },
        },
      },
      requests: [],
    },
  };
}

function resultEvent(
  index: number,
  opts: {
    details?: string;
    promptTokens?: number;
    completionTokens?: number;
    agentId?: string;
    errorDetails?: Record<string, unknown> | null;
  }
) {
  const v: Record<string, unknown> = {
    timings: { firstProgress: 100, totalElapsed: 200 },
    metadata: {
      responseId: "resp-" + index,
      sessionId: "test-session",
      agentId: opts.agentId ?? "github.copilot.editsAgent",
    },
  };
  if (opts.details !== undefined) v.details = opts.details;
  if (opts.promptTokens != null || opts.completionTokens != null) {
    v.usage = {
      promptTokens: opts.promptTokens ?? 0,
      completionTokens: opts.completionTokens ?? 0,
    };
  }
  if (opts.errorDetails != null) v.errorDetails = opts.errorDetails;
  return {
    kind: 1,
    k: ["requests", index, "result"],
    v,
  };
}

function pendingSlot(index: number) {
  // A whole-slot write WITHOUT a `result` field — represents an in-flight
  // request whose result hasn't landed yet.
  return {
    kind: 1,
    k: ["requests", index],
    v: { message: { text: "thinking..." } },
  };
}

describe("parseMultiplierFromDetails", () => {
  it("extracts integer multipliers", () => {
    expect(parseMultiplierFromDetails("Grok Code Fast 1 • 1x")).toBe(1);
    expect(parseMultiplierFromDetails("Claude Opus 4.7 • 10x")).toBe(10);
    expect(parseMultiplierFromDetails("o3 • 10x")).toBe(10);
  });

  it("extracts fractional multipliers", () => {
    expect(parseMultiplierFromDetails("o3-mini • 0.33x")).toBe(0.33);
    expect(parseMultiplierFromDetails("claude-haiku • 0.25x")).toBe(0.25);
  });

  it("returns undefined for missing or unrecognised input", () => {
    expect(parseMultiplierFromDetails(undefined)).toBeUndefined();
    expect(parseMultiplierFromDetails(null)).toBeUndefined();
    expect(parseMultiplierFromDetails("")).toBeUndefined();
    expect(parseMultiplierFromDetails("Unknown")).toBeUndefined();
    expect(parseMultiplierFromDetails("Claude Sonnet 4")).toBeUndefined();
  });

  it("ignores leading text and matches the trailing suffix", () => {
    expect(parseMultiplierFromDetails("Some • Other • 5x")).toBe(5);
  });
});

describe("parseModelFromDetails", () => {
  it("strips the trailing multiplier suffix", () => {
    expect(parseModelFromDetails("Claude Opus 4.7 • 10x")).toBe(
      "Claude Opus 4.7"
    );
    expect(parseModelFromDetails("Grok Code Fast 1 • 1x")).toBe(
      "Grok Code Fast 1"
    );
  });

  it("returns the input when no suffix is present", () => {
    expect(parseModelFromDetails("Claude Sonnet 4")).toBe("Claude Sonnet 4");
  });

  it("returns undefined for empty input", () => {
    expect(parseModelFromDetails(undefined)).toBeUndefined();
    expect(parseModelFromDetails(null)).toBeUndefined();
    expect(parseModelFromDetails("")).toBeUndefined();
  });
});

describe("normaliseCopilotUsage", () => {
  it("maps camelCase prompt/completion tokens to canonical shape", () => {
    const u = normaliseCopilotUsage({
      promptTokens: 38472,
      completionTokens: 197,
    });
    expect(u).toEqual({
      input_tokens: 38472,
      output_tokens: 197,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it("zeroes cache fields (VS Code Copilot Chat doesn't expose them)", () => {
    const u = normaliseCopilotUsage({ promptTokens: 100, completionTokens: 50 });
    expect(u.cache_creation_input_tokens).toBe(0);
    expect(u.cache_read_input_tokens).toBe(0);
  });

  it("returns zeroed usage for null/empty input", () => {
    expect(normaliseCopilotUsage(null)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it("coerces stringified numbers", () => {
    const u = normaliseCopilotUsage({
      promptTokens: "42",
      completionTokens: "7",
    });
    expect(u.input_tokens).toBe(42);
    expect(u.output_tokens).toBe(7);
  });
});

describe("tokensFromCopilotEvents", () => {
  function lines(entries: unknown[]): string[] {
    return entries.map((e) => JSON.stringify(e));
  }

  it("sums tokens per request", () => {
    const ls = lines([
      header({ modelName: "Auto" }),
      resultEvent(0, {
        details: "Claude Opus 4.7 • 10x",
        promptTokens: 100,
        completionTokens: 50,
      }),
      resultEvent(1, {
        details: "Claude Opus 4.7 • 10x",
        promptTokens: 200,
        completionTokens: 75,
      }),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests.length).toBe(2);
    expect(state.requests[0].tokens.input_tokens).toBe(100);
    expect(state.requests[1].tokens.output_tokens).toBe(75);
    expect(state.requests[0].multiplier).toBe(10);
    expect(state.requests[0].model).toBe("Claude Opus 4.7");
  });

  it("handles multi-request session with mixed multipliers", () => {
    const ls = lines([
      header(),
      resultEvent(0, {
        details: "Grok Code Fast 1 • 1x",
        promptTokens: 1000,
        completionTokens: 200,
      }),
      resultEvent(1, {
        details: "Claude Opus 4.7 • 10x",
        promptTokens: 500,
        completionTokens: 100,
      }),
      resultEvent(2, {
        details: "o3-mini • 0.33x",
        promptTokens: 250,
        completionTokens: 50,
      }),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests.length).toBe(3);
    expect(state.requests.map((r) => r.multiplier)).toEqual([1, 10, 0.33]);
    expect(state.requests.map((r) => r.model)).toEqual([
      "Grok Code Fast 1",
      "Claude Opus 4.7",
      "o3-mini",
    ]);
  });

  it("records hasPendingRequest when a slot has no result yet", () => {
    const ls = lines([
      header(),
      pendingSlot(0),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests.length).toBe(0);
    expect(state.hasPendingRequest).toBe(true);
  });

  it("falls back to header inputState model when details is missing", () => {
    const ls = lines([
      header({ modelName: "Auto" }),
      resultEvent(0, { promptTokens: 10, completionTokens: 5 }),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests[0].model).toBe("Auto");
    expect(state.requests[0].multiplier).toBeUndefined();
  });

  it("captures the agentId from the last result", () => {
    const ls = lines([
      header(),
      resultEvent(0, {
        details: "Claude Opus 4.7 • 10x",
        promptTokens: 1,
        completionTokens: 1,
        agentId: "github.copilot.askAgent",
      }),
      resultEvent(1, {
        details: "Claude Opus 4.7 • 10x",
        promptTokens: 1,
        completionTokens: 1,
        agentId: "github.copilot.terminalAgent",
      }),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.lastAgentId).toBe("github.copilot.terminalAgent");
  });

  it("marks the last request as errored when errorDetails is present", () => {
    const ls = lines([
      header(),
      resultEvent(0, {
        details: "Claude Sonnet 4 • 1x",
        promptTokens: 100,
        completionTokens: 0,
        errorDetails: { code: "canceled", message: "Canceled" },
      }),
    ]);
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests[0].hadError).toBe(true);
  });

  it("ignores unparseable lines", () => {
    const ls = [
      JSON.stringify(header()),
      "{ not valid",
      JSON.stringify(
        resultEvent(0, {
          details: "Claude Opus 4.7 • 10x",
          promptTokens: 50,
          completionTokens: 25,
        })
      ),
    ];
    const state = tokensFromCopilotEvents(ls, {
      requests: [],
      hasPendingRequest: false,
      headerModel: null,
      lastAgentId: null,
    });
    expect(state.requests.length).toBe(1);
  });
});

describe("statusFromCopilotState", () => {
  const minuteAgo = Date.now() - 60_000;
  const old = Date.now() - 30 * 86_400_000;

  it("returns idle for a transcript with no requests", () => {
    const s = statusFromCopilotState(
      { requests: [], hasPendingRequest: false, headerModel: null, lastAgentId: null },
      old
    );
    expect(s.status).toBe("idle");
  });

  it("returns awaiting_input when the last request completed", () => {
    const s = statusFromCopilotState(
      {
        requests: [
          {
            model: "Claude Opus 4.7",
            multiplier: 10,
            tokens: {
              input_tokens: 1,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            hadError: false,
          },
        ],
        hasPendingRequest: false,
        headerModel: null,
        lastAgentId: null,
      },
      minuteAgo
    );
    expect(s.status).toBe("awaiting_input");
  });

  it("returns needs_attention when the last result had errorDetails", () => {
    const s = statusFromCopilotState(
      {
        requests: [
          {
            model: null,
            multiplier: 1,
            tokens: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            hadError: true,
          },
        ],
        hasPendingRequest: false,
        headerModel: null,
        lastAgentId: null,
      },
      minuteAgo
    );
    expect(s.status).toBe("needs_attention");
  });

  it("returns running when mtime is very recent and a request exists", () => {
    const s = statusFromCopilotState(
      {
        requests: [
          {
            model: null,
            multiplier: 1,
            tokens: {
              input_tokens: 1,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            hadError: false,
          },
        ],
        hasPendingRequest: false,
        headerModel: null,
        lastAgentId: null,
      },
      Date.now() - 5_000
    );
    expect(s.status).toBe("running");
  });

  it("returns processing when a slot is pending without any completed requests", () => {
    const s = statusFromCopilotState(
      {
        requests: [],
        hasPendingRequest: true,
        headerModel: null,
        lastAgentId: null,
      },
      minuteAgo
    );
    expect(s.status).toBe("processing");
  });

  it("returns idle for an old transcript with no requests (never reports dead)", () => {
    const s = statusFromCopilotState(
      { requests: [], hasPendingRequest: false, headerModel: null, lastAgentId: null },
      Date.now() - 365 * 86_400_000
    );
    expect(s.status).toBe("idle");
  });
});
