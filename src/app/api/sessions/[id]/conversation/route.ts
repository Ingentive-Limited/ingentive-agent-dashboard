import { NextResponse } from "next/server";
import fs from "fs";
import {
  findSessionJsonl,
  readConversationLines,
  getConversationPreview,
  parseProvider,
} from "@/lib/agent-data";

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
  const provider = parseProvider(searchParams.get("provider"));

  if (!SESSION_ID_RE.test(id)) {
    return NextResponse.json(
      { error: "Invalid session ID format" },
      { status: 400 }
    );
  }

  // Codex sessions use a completely different JSONL format than Claude
  // (event_msg/response_item vs human/assistant). Delegate to the Codex-specific
  // parser in getConversationPreview, then translate to this route's shape so
  // the existing ConversationViewer component can render it without changes.
  if (provider === "codex") {
    try {
      const previews = await getConversationPreview(id, MAX_MESSAGES, "codex");
      const messages = previews.map((m) => ({
        // Map Codex role → this route's entry.type
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
