import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getStatusFromEvents,
  tokensFromEvents,
  normaliseScoutUsage,
} from "@/lib/scout-data";
import type { TokenUsage } from "@/lib/types";

/**
 * Fixtures match the on-disk shape of ~/.copilot/session-state/<id>/events.jsonl
 * for a Microsoft Scout session (copilot-agent producer). Field names are
 * camelCase, model ids are dotted (e.g. "claude-opus-4.7"), and the per-model
 * usage aggregate appears on session.shutdown.modelMetrics.<model>.usage.
 */

const NOW_ISO = "2026-06-17T12:00:00.000Z";
const NEAR_NOW_ISO = new Date(Date.now() - 5_000).toISOString();
const OLD_ISO = "2026-06-10T09:12:55.000Z";

function sessionStart(model = "claude-opus-4.7") {
  return {
    type: "session.start",
    data: {
      sessionId: "test-session",
      copilotVersion: "1.0.50",
      startTime: OLD_ISO,
      selectedModel: model,
      context: { cwd: "/Users/test/Documents/Microsoft Scout" },
    },
    timestamp: OLD_ISO,
  };
}

function userMessage(ts = OLD_ISO) {
  return {
    type: "user.message",
    data: { content: "hello" },
    timestamp: ts,
  };
}

function assistantTurnStart(ts = OLD_ISO) {
  return { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: ts };
}

function assistantTurnEnd(ts = OLD_ISO) {
  return { type: "assistant.turn_end", data: { turnId: "0" }, timestamp: ts };
}

function assistantMessage(opts: {
  model?: string;
  text?: string;
  usage?: Record<string, number>;
  ts?: string;
}) {
  const data: Record<string, unknown> = {
    model: opts.model ?? "claude-opus-4.7",
    content: opts.text ?? "",
  };
  if (opts.usage) data.usage = opts.usage;
  return {
    type: "assistant.message",
    data,
    timestamp: opts.ts ?? OLD_ISO,
  };
}

function permissionRequested(ts = OLD_ISO) {
  return {
    type: "permission.requested",
    data: { toolName: "shell" },
    timestamp: ts,
  };
}

function sessionShutdown(metricsByModel: Record<string, Record<string, number>>) {
  return {
    type: "session.shutdown",
    data: {
      modelMetrics: Object.fromEntries(
        Object.entries(metricsByModel).map(([m, u]) => [m, { usage: u }])
      ),
    },
    timestamp: NOW_ISO,
  };
}

function writeFixture(entries: unknown[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-test-"));
  const filePath = path.join(tmpDir, "events.jsonl");
  fs.writeFileSync(
    filePath,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  return filePath;
}

const empty: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

describe("normaliseScoutUsage", () => {
  it("maps camelCase to snake_case", () => {
    const u = normaliseScoutUsage({
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 25,
      cacheReadTokens: 200,
      reasoningTokens: 10,
    });
    expect(u).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 25,
      cache_read_input_tokens: 200,
      reasoning_tokens: 10,
    });
  });

  it("omits reasoning_tokens when zero", () => {
    const u = normaliseScoutUsage({
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    });
    expect(u.reasoning_tokens).toBeUndefined();
  });

  it("returns zeroed usage for null/empty input", () => {
    expect(normaliseScoutUsage(null)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      reasoning_tokens: undefined,
    });
  });

  it("coerces stringified numbers", () => {
    const u = normaliseScoutUsage({
      inputTokens: "42",
      outputTokens: "7",
      cacheWriteTokens: "0",
      cacheReadTokens: "0",
    });
    expect(u.input_tokens).toBe(42);
    expect(u.output_tokens).toBe(7);
  });
});

describe("getStatusFromEvents", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const f of created) {
      try {
        fs.rmSync(path.dirname(f), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    created.length = 0;
  });

  function fixture(entries: unknown[]): string {
    const p = writeFixture(entries);
    created.push(p);
    return p;
  }

  it("returns idle when path is null", () => {
    expect(getStatusFromEvents(null)).toEqual({ status: "idle" });
  });

  it("returns idle when the file does not exist", () => {
    expect(getStatusFromEvents("/tmp/scout-does-not-exist.jsonl")).toEqual({
      status: "idle",
    });
  });

  it("returns idle for an empty file", () => {
    const f = fixture([]);
    expect(getStatusFromEvents(f)).toEqual({ status: "idle" });
  });

  it("detects awaiting_input when the last assistant turn completed", () => {
    const f = fixture([
      sessionStart(),
      userMessage(),
      assistantTurnStart(),
      assistantMessage({ text: "Hi there!" }),
      assistantTurnEnd(),
    ]);
    expect(getStatusFromEvents(f)).toEqual({
      status: "awaiting_input",
      lastMessage: "Hi there!",
    });
  });

  it("detects needs_attention on an unresolved permission request", () => {
    const f = fixture([
      sessionStart(),
      userMessage(),
      assistantTurnStart(),
      permissionRequested(),
    ]);
    expect(getStatusFromEvents(f).status).toBe("needs_attention");
  });

  it("returns running when lock is held and last event is recent", () => {
    const f = fixture([
      sessionStart(),
      userMessage(NEAR_NOW_ISO),
      assistantTurnStart(NEAR_NOW_ISO),
    ]);
    expect(getStatusFromEvents(f, true).status).toBe("running");
  });

  it("returns processing when a user.message is unanswered (no lock)", () => {
    const f = fixture([sessionStart(), userMessage()]);
    expect(getStatusFromEvents(f).status).toBe("processing");
  });

  it("returns dead on session.shutdown regardless of lock", () => {
    const f = fixture([
      sessionStart(),
      userMessage(),
      assistantMessage({ text: "done" }),
      sessionShutdown({ "claude-opus-4.7": { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 } }),
    ]);
    expect(getStatusFromEvents(f, true).status).toBe("dead");
  });

  it("ignores malformed JSON lines", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-test-"));
    const filePath = path.join(tmpDir, "events.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify(sessionStart()),
        "{ not valid",
        JSON.stringify(userMessage()),
        "garbage",
        JSON.stringify(assistantMessage({ text: "Done." })),
        JSON.stringify(assistantTurnEnd()),
      ].join("\n")
    );
    created.push(filePath);
    expect(getStatusFromEvents(filePath).status).toBe("awaiting_input");
  });
});

describe("tokensFromEvents", () => {
  it("sums per-message usage by model", () => {
    const lines = [
      sessionStart(),
      assistantMessage({
        model: "claude-opus-4.7",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheWriteTokens: 10,
          cacheReadTokens: 20,
        },
      }),
      assistantMessage({
        model: "claude-opus-4.7",
        usage: {
          inputTokens: 200,
          outputTokens: 75,
          cacheWriteTokens: 5,
          cacheReadTokens: 30,
        },
      }),
    ].map((e) => JSON.stringify(e));

    const result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.tokensByModel.size).toBe(1);
    const opus = result.tokensByModel.get("claude-opus-4.7");
    expect(opus).toEqual({
      input_tokens: 300,
      output_tokens: 125,
      cache_creation_input_tokens: 15,
      cache_read_input_tokens: 50,
      reasoning_tokens: undefined,
    });
  });

  it("attributes tokens per model across a mid-session model switch", () => {
    const lines = [
      sessionStart("claude-opus-4.7"),
      assistantMessage({
        model: "claude-opus-4.7",
        usage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
      assistantMessage({
        model: "claude-sonnet-4.7",
        usage: { inputTokens: 200, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
      assistantMessage({
        model: "claude-sonnet-4.7",
        usage: { inputTokens: 30, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
    ].map((e) => JSON.stringify(e));

    const result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.tokensByModel.get("claude-opus-4.7")?.input_tokens).toBe(100);
    expect(result.tokensByModel.get("claude-sonnet-4.7")?.input_tokens).toBe(230);
    expect(result.tokensByModel.get("claude-sonnet-4.7")?.output_tokens).toBe(70);
  });

  it("returns no tokens when no usage events are present", () => {
    const lines = [
      sessionStart(),
      assistantMessage({ model: "claude-opus-4.7", text: "no usage here" }),
    ].map((e) => JSON.stringify(e));

    const result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.tokensByModel.size).toBe(0);
  });

  it("uses session.shutdown.modelMetrics aggregate when present", () => {
    const lines = [
      sessionStart(),
      // Older Scout build: no per-message usage at all.
      assistantMessage({ model: "claude-opus-4.7", text: "" }),
      sessionShutdown({
        "claude-opus-4.7": {
          inputTokens: 1381968,
          outputTokens: 4725,
          cacheWriteTokens: 225793,
          cacheReadTokens: 1156146,
          reasoningTokens: 0,
        },
      }),
    ].map((e) => JSON.stringify(e));

    const result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.shutdownSeen).toBe(true);
    expect(result.tokensByModel.get("claude-opus-4.7")).toEqual({
      input_tokens: 1381968,
      output_tokens: 4725,
      cache_creation_input_tokens: 225793,
      cache_read_input_tokens: 1156146,
      reasoning_tokens: undefined,
    });
  });

  it("prefers shutdown aggregate over per-message accumulation", () => {
    // Both shapes present — shutdown wins to avoid double-counting.
    const lines = [
      sessionStart(),
      assistantMessage({
        model: "claude-opus-4.7",
        usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
      sessionShutdown({
        "claude-opus-4.7": {
          inputTokens: 999,
          outputTokens: 888,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    ].map((e) => JSON.stringify(e));

    const result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.tokensByModel.get("claude-opus-4.7")?.input_tokens).toBe(999);
    expect(result.tokensByModel.get("claude-opus-4.7")?.output_tokens).toBe(888);
  });

  it("handles empty input", () => {
    const result = tokensFromEvents([], {
      tokensByModel: new Map(),
      shutdownSeen: false,
    });
    expect(result.tokensByModel.size).toBe(0);
    expect(empty.input_tokens).toBe(0); // sanity: empty fixture compiles
  });
});
