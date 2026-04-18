"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, User, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: string;
  summary?: string;
}

interface ConversationMessage {
  type: "human" | "assistant";
  content: ContentBlock[];
  timestamp?: string;
  costUSD?: number;
  model?: string;
}

function ToolUseBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border bg-muted/30 p-2 text-xs my-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`Tool call: ${block.name}`}
      >
        <Wrench className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <Badge variant="secondary" className="text-xs font-mono">
          {block.name}
        </Badge>
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {expanded && block.input && (
        <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono bg-muted/50 rounded p-2">
          {block.input}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2 text-xs my-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left text-muted-foreground"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Tool result"
      >
        <span className="text-green-500">↩</span>
        <span>Tool result</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" aria-hidden="true" />
        )}
      </button>
      {expanded && block.summary && (
        <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono bg-muted/50 rounded p-2">
          {block.summary}
        </pre>
      )}
    </div>
  );
}

function MessageBubble({ message, assistantName = "Claude" }: { message: ConversationMessage; assistantName?: string }) {
  const isHuman = message.type === "human";

  const textContent = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const toolUseBlocks = message.content.filter((b) => b.type === "tool_use");
  const toolResultBlocks = message.content.filter((b) => b.type === "tool_result");

  return (
    <div className={`flex gap-3 ${isHuman ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isHuman ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
        aria-hidden="true"
      >
        {isHuman ? (
          <User className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={`flex-1 space-y-1 ${isHuman ? "text-right" : ""} max-w-[85%]`}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{isHuman ? "You" : assistantName}</span>
          {message.timestamp && (
            <span>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {message.model && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {message.model.replace("claude-", "").split("-202")[0]}
            </Badge>
          )}
          {message.costUSD != null && message.costUSD > 0 && (
            <span className="text-[10px] opacity-60">
              ${message.costUSD.toFixed(4)}
            </span>
          )}
        </div>
        <div
          className={`rounded-lg p-3 text-sm ${
            isHuman
              ? "bg-primary text-primary-foreground ml-auto"
              : "bg-muted"
          }`}
        >
          {textContent && (
            <div className="whitespace-pre-wrap break-words">{textContent}</div>
          )}
          {toolUseBlocks.map((block, i) => (
            <ToolUseBlock key={`tool-${i}`} block={block} />
          ))}
          {toolResultBlocks.map((block, i) => (
            <ToolResultBlock key={`result-${i}`} block={block} />
          ))}
          {!textContent && toolUseBlocks.length === 0 && toolResultBlocks.length === 0 && (
            <span className="text-muted-foreground italic">Empty message</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConversationViewer({
  sessionId,
  projectName,
  open,
  onOpenChange,
  providerName = "Claude",
  provider = "claude",
}: {
  sessionId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName?: string;
  /** Underlying provider for correct server-side JSONL parsing. */
  provider?: "claude" | "codex";
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!open || !sessionId) return;

    let cancelled = false;

    const loadConversation = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/conversation?provider=${provider}`
        );
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load conversation");
        }
        const data = await res.json();
        if (cancelled) return;
        setMessages(data.messages || []);
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setMessages([]);
    setError(null);
    setLoading(true);
    loadConversation();

    return () => { cancelled = true; };
  }, [open, sessionId, provider]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-lg md:max-w-xl lg:max-w-2xl w-full"
      >
        <SheetHeader>
          <SheetTitle>Conversation — {projectName}</SheetTitle>
          <SheetDescription>
            Session {sessionId.slice(0, 12)}...
            {messages.length > 0 && (
              <span> · {messages.length} messages</span>
            )}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-4 pb-4">
          {loading ? (
            <div className="space-y-4 py-4" role="status">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                  </div>
                </div>
              ))}
              <span className="sr-only">Loading conversation...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12" role="alert">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  fetch(
                    `/api/sessions/${encodeURIComponent(sessionId)}/conversation?provider=${provider}`
                  )
                    .then((r) => r.json())
                    .then((d) => setMessages(d.messages || []))
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                Retry
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Bot className="h-10 w-10 text-muted-foreground/30 mb-3" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No messages found</p>
            </div>
          ) : (
            <ul className="space-y-4 py-4 list-none" role="list" aria-label="Conversation messages">
              {messages.map((msg, i) => (
                <li key={i}>
                  <MessageBubble message={msg} assistantName={providerName} />
                </li>
              ))}
              <li ref={bottomRef} aria-hidden="true" />
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
