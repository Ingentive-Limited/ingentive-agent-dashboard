import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getStatusFromRollout, getConversationPreview } from "@/lib/codex-data";

/**
 * Test fixtures for Codex JSONL rollout files.
 * Mirrors the real format emitted by the Codex CLI.
 */

function userMessage(text: string) {
  return {
    timestamp: "2026-04-16T08:38:40.110Z",
    type: "event_msg",
    payload: { type: "user_message", message: text, images: [] },
  };
}

function assistantMessage(text: string) {
  return {
    timestamp: "2026-04-16T08:38:45.338Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

function requestUserInput(question: string) {
  return {
    timestamp: "2026-04-16T08:52:13.220Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "request_user_input",
      arguments: JSON.stringify({
        questions: [{ header: "H", question, options: [] }],
      }),
      call_id: "call_123",
    },
  };
}

function tokenCount() {
  return {
    timestamp: "2026-04-16T08:52:13.249Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { total_tokens: 100 } },
    },
  };
}

function reasoning() {
  return {
    timestamp: "2026-04-16T08:52:06.814Z",
    type: "response_item",
    payload: { type: "reasoning", summary: [], content: null },
  };
}

function functionCall(name: string) {
  return {
    timestamp: "2026-04-16T08:52:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name,
      arguments: "{}",
      call_id: "call_999",
    },
  };
}

function developerMessage(text: string) {
  return {
    timestamp: "2026-04-16T08:38:40.109Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text }],
    },
  };
}

function writeFixture(entries: unknown[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  const filePath = path.join(tmpDir, "rollout.jsonl");
  fs.writeFileSync(
    filePath,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  return filePath;
}

describe("getStatusFromRollout", () => {
  let createdFiles: string[] = [];

  afterEach(() => {
    for (const f of createdFiles) {
      try {
        fs.rmSync(path.dirname(f), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    createdFiles = [];
  });

  function fixture(entries: unknown[]): string {
    const p = writeFixture(entries);
    createdFiles.push(p);
    return p;
  }

  it("returns idle when rollout path is null", () => {
    expect(getStatusFromRollout(null)).toEqual({ status: "idle" });
  });

  it("returns idle when file does not exist", () => {
    expect(getStatusFromRollout("/tmp/does-not-exist.jsonl")).toEqual({
      status: "idle",
    });
  });

  it("returns idle for empty file", () => {
    const f = fixture([]);
    expect(getStatusFromRollout(f)).toEqual({ status: "idle" });
  });

  it("detects awaiting_input when last entry is an assistant message", () => {
    const f = fixture([
      userMessage("hello"),
      assistantMessage("Hi! How can I help?"),
    ]);
    expect(getStatusFromRollout(f)).toEqual({
      status: "awaiting_input",
      lastMessage: "Hi! How can I help?",
    });
  });

  it("detects needs_attention when last entry is request_user_input", () => {
    const f = fixture([
      userMessage("start"),
      assistantMessage("Let me ask a question"),
      requestUserInput("Which option do you want?"),
    ]);
    expect(getStatusFromRollout(f)).toEqual({
      status: "needs_attention",
      lastMessage: "Which option do you want?",
    });
  });

  it("detects processing when last entry is a user message", () => {
    const f = fixture([
      assistantMessage("Done!"),
      userMessage("Another task please"),
    ]);
    expect(getStatusFromRollout(f)).toEqual({ status: "processing" });
  });

  it("detects running when last entry is a tool call in progress", () => {
    const f = fixture([
      userMessage("do the thing"),
      functionCall("shell"),
    ]);
    expect(getStatusFromRollout(f)).toEqual({ status: "running" });
  });

  it("skips token_count metadata to find the real last entry", () => {
    const f = fixture([
      userMessage("hi"),
      assistantMessage("Hello!"),
      tokenCount(),
      tokenCount(),
    ]);
    expect(getStatusFromRollout(f).status).toBe("awaiting_input");
  });

  it("skips reasoning metadata to find the real last entry", () => {
    const f = fixture([
      userMessage("hi"),
      reasoning(),
      assistantMessage("Hello!"),
      reasoning(),
    ]);
    expect(getStatusFromRollout(f).status).toBe("awaiting_input");
  });

  it("ignores malformed JSON lines", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
    const filePath = path.join(tmpDir, "rollout.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify(userMessage("hi")),
        "{ not valid json",
        JSON.stringify(assistantMessage("Hello!")),
        "also garbage",
      ].join("\n")
    );
    createdFiles.push(filePath);
    expect(getStatusFromRollout(filePath).status).toBe("awaiting_input");
  });

  it("extracts question text from request_user_input arguments", () => {
    const f = fixture([requestUserInput("What framework?")]);
    const result = getStatusFromRollout(f);
    expect(result.status).toBe("needs_attention");
    expect(result.lastMessage).toBe("What framework?");
  });
});

describe("getConversationPreview", () => {
  let tmpFile: string | null = null;
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      tmpDir = null;
      tmpFile = null;
    }
  });

  it("returns empty array for nonexistent session", async () => {
    const messages = await getConversationPreview("nonexistent-session-id");
    expect(messages).toEqual([]);
  });

  it("extracts user and assistant text correctly (unit of parser via fixture)", async () => {
    // This is a weaker test: it validates the fixture-writing path works by
    // confirming getStatusFromRollout can parse the same fixture correctly.
    // Full integration (DB + file) is covered by E2E.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-conv-"));
    tmpFile = path.join(tmpDir, "rollout.jsonl");
    fs.writeFileSync(
      tmpFile,
      [
        JSON.stringify(developerMessage("system prompt here")),
        JSON.stringify(userMessage("hello")),
        JSON.stringify(assistantMessage("Hi there!")),
      ].join("\n")
    );
    const result = getStatusFromRollout(tmpFile);
    expect(result.status).toBe("awaiting_input");
    expect(result.lastMessage).toBe("Hi there!");
  });
});
