import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getStatusFromAudit } from "@/lib/cowork-data";

/**
 * Fixtures matching the real Cowork audit.jsonl shape — entries written by
 * the Claude Desktop app for each turn of a local-agent (Cowork) session.
 */

function userMessage(text: string) {
  return {
    type: "user",
    message: { role: "user", content: text },
    session_id: "sess-1",
    uuid: "u-1",
    _audit_timestamp: "2026-04-12T10:00:00.000Z",
  };
}

function assistantText(text: string, stopReason: string = "end_turn") {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    session_id: "sess-1",
    uuid: "a-1",
    _audit_timestamp: "2026-04-12T10:00:01.000Z",
  };
}

function assistantToolUse(toolName: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "let me check" },
        { type: "tool_use", name: toolName, input: {} },
      ],
      stop_reason: "tool_use",
    },
    session_id: "sess-1",
    uuid: "a-2",
    _audit_timestamp: "2026-04-12T10:00:02.000Z",
  };
}

function systemInit() {
  return {
    type: "system",
    subtype: "init",
    session_id: "sess-1",
    cwd: "/sessions/example",
    _audit_timestamp: "2026-04-12T09:59:59.000Z",
  };
}

function writeFixture(entries: unknown[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-test-"));
  const filePath = path.join(tmpDir, "audit.jsonl");
  fs.writeFileSync(
    filePath,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  return filePath;
}

describe("getStatusFromAudit", () => {
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
    expect(getStatusFromAudit(null)).toEqual({ status: "idle" });
  });

  it("returns idle when the file does not exist", () => {
    expect(getStatusFromAudit("/tmp/cowork-does-not-exist.jsonl")).toEqual({
      status: "idle",
    });
  });

  it("returns idle for an empty file", () => {
    const f = fixture([]);
    expect(getStatusFromAudit(f)).toEqual({ status: "idle" });
  });

  it("detects awaiting_input when the last assistant turn ended naturally", () => {
    const f = fixture([
      systemInit(),
      userMessage("hello"),
      assistantText("Hi there!"),
    ]);
    expect(getStatusFromAudit(f)).toEqual({
      status: "awaiting_input",
      lastMessage: "Hi there!",
    });
  });

  it("detects needs_attention when the last assistant turn asked a question", () => {
    const f = fixture([
      userMessage("hello"),
      assistantText("Looking at this", "end_turn"),
      userMessage("go on"),
      assistantToolUse("AskUserQuestion"),
    ]);
    expect(getStatusFromAudit(f)).toEqual({ status: "needs_attention" });
  });

  it("detects needs_attention when the last assistant turn entered plan mode", () => {
    const f = fixture([userMessage("plan it"), assistantToolUse("ExitPlanMode")]);
    expect(getStatusFromAudit(f)).toEqual({ status: "needs_attention" });
  });

  it("detects running when the last assistant turn invoked another tool", () => {
    const f = fixture([userMessage("look it up"), assistantToolUse("Bash")]);
    expect(getStatusFromAudit(f)).toEqual({ status: "running" });
  });

  it("detects processing when the last entry is a user message", () => {
    const f = fixture([
      assistantText("Done!"),
      userMessage("Another task please"),
    ]);
    expect(getStatusFromAudit(f)).toEqual({ status: "processing" });
  });

  it("skips system/result entries when finding the last meaningful turn", () => {
    const f = fixture([
      userMessage("hi"),
      assistantText("Hello!"),
      systemInit(),
      { type: "result", subtype: "summary", _audit_timestamp: "x" },
    ]);
    expect(getStatusFromAudit(f).status).toBe("awaiting_input");
  });

  it("ignores malformed JSON lines without crashing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-test-"));
    const filePath = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify(userMessage("hi")),
        "{ not valid json",
        JSON.stringify(assistantText("Hello!")),
        "garbage line",
      ].join("\n")
    );
    created.push(filePath);
    expect(getStatusFromAudit(filePath).status).toBe("awaiting_input");
  });

  it("extracts the assistant text into lastMessage on end_turn", () => {
    const longText = "x".repeat(400);
    const f = fixture([userMessage("go"), assistantText(longText)]);
    const result = getStatusFromAudit(f);
    expect(result.status).toBe("awaiting_input");
    // lastMessage is truncated to 200 chars
    expect(result.lastMessage?.length).toBe(200);
  });
});
