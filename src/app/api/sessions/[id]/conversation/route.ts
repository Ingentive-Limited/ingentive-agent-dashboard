import { NextResponse } from "next/server";
import fs from "fs";
import {
  findSessionJsonl,
  readConversationLines,
  getConversationPreview,
} from "@/lib/agent-data";

/**
 * Conversation-specific provider parsing. Unlike the UI provider filter
 * (claude / codex / all), the conversation viewer needs to be able to ask
 * for a "cowork" or "scout" session explicitly — both live under the Claude
 * family in the sidebar but have their own JSONL parsers.
 */
type ConversationProvider =
  | "claude"
  | "codex"
  | "cowork"
  | "scout"
  | "copilot"
  | "all";

function parseConversationProvider(value: string | null): ConversationProvider {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "cowork" ||
    value === "scout" ||
    value === "copilot"
  ) {
    return value;
  }
  return "all";
}

export const dynamic = "force-dynamic";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_MESSAGES = 200;

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

interface ParsedContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: string;
  summary?: string;
}

function summarizeContentBlocks(
  blocks: ContentBlock[]
): ParsedContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text ?? "" };
    }
    if (block.type === "tool_use") {
      const inputStr =
        typeof block.input === "string"
          ? block.input
          : JSON.stringify(block.input ?? "");
      return {
        type: "tool_use",
        name: block.name ?? "unknown",
        input: inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr,
      };
    }
    if (block.type === "tool_result") {
      let summary = "tool result";
      if (typeof block.content === "string") {
        summary = block.content.slice(0, 200);
      } else if (Array.isArray(block.content)) {
        summary = block.content
          .filter((c: ContentBlock) => c.type === "text")
          .map((c: ContentBlock) => c.text ?? "")
          .join("\n")
          .slice(0, 200);
      }
      return { type: "tool_result", summary };
    }
    return { type: block.type };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const provider = parseConversationProvider(searchParams.get("provider"));

  if (!SESSION_ID_RE.test(id)) {
    return NextResponse.json(
      { error: "Invalid session ID format" },
      { status: 400 }
    );
  }

  // Codex, Cowork, Scout, and Copilot sessions use different JSONL formats
  // than Claude Code's projects/*.jsonl. Delegate to each provider's
  // getConversationPreview and translate to this route's shape so the
  // existing ConversationViewer component can render them without changes.
  if (
    provider === "codex" ||
    provider === "cowork" ||
    provider === "scout" ||
    provider === "copilot"
  ) {
    try {
      const previews = await getConversationPreview(id, MAX_MESSAGES, provider);
      const messages = previews.map((m) => ({
        // Map normalized role → this route's entry.type
        type: m.role === "user" ? "human" : "assistant",
        content: [{ type: "text", text: m.text }],
        timestamp: m.timestamp,
      }));
      return NextResponse.json({ messages });
    } catch {
      return NextResponse.json(
        { error: "Failed to read conversation log" },
        { status: 500 }
      );
    }
  }

  const jsonlPath = findSessionJsonl(id, "claude");
  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    return NextResponse.json(
      { error: "Conversation log not found" },
      { status: 404 }
    );
  }

  try {
    // Read only the last ~600 lines (3x max messages) to avoid streaming
    // entire multi-hundred-MB files for long-running sessions
    const lines = await readConversationLines(jsonlPath, MAX_MESSAGES * 3);
    const messages: Record<string, unknown>[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "human" && entry.type !== "assistant") continue;

        const content: ParsedContentBlock[] = Array.isArray(
          entry.message?.content
        )
          ? summarizeContentBlocks(entry.message.content)
          : [];

        const msg: Record<string, unknown> = {
          type: entry.type,
          content,
        };

        const ts = entry.createdAt || entry.timestamp;
        if (ts) msg.timestamp = ts;
        if (entry.costUSD != null) msg.costUSD = entry.costUSD;
        if (entry.model) msg.model = entry.model;

        messages.push(msg);
      } catch {
        /* skip unparseable lines */
      }
    }

    return NextResponse.json({
      messages: messages.slice(-MAX_MESSAGES),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to read conversation log" },
      { status: 500 }
    );
  }
}
