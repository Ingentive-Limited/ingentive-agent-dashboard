"use client";

import { Badge } from "@/components/ui/badge";
import type { SessionStatus } from "@/lib/types";

const statusConfig: Record<
  SessionStatus,
  { label: string; className: string; dotClass: string; shape: "circle" | "diamond" | "triangle" | "square" }
> = {
  running: {
    label: "Running",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    dotClass: "bg-blue-500 animate-pulse",
    shape: "circle",
  },
  awaiting_input: {
    label: "Awaiting Input",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    dotClass: "bg-amber-500 animate-pulse",
    shape: "diamond",
  },
  needs_attention: {
    label: "Needs Attention",
    className: "bg-red-500/10 text-red-500 border-red-500/20",
    dotClass: "bg-red-500 animate-pulse",
    shape: "triangle",
  },
  processing: {
    label: "Processing",
    className: "bg-green-500/10 text-green-500 border-green-500/20",
    dotClass: "bg-green-500 animate-pulse",
    shape: "circle",
  },
  idle: {
    label: "Idle",
    className: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
    shape: "square",
  },
  dead: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground/50",
    shape: "square",
  },
};

function StatusIndicator({ shape, dotClass }: { shape: string; dotClass: string }) {
  switch (shape) {
    case "diamond":
      return <span className={`h-1.5 w-1.5 rotate-45 ${dotClass}`} aria-hidden="true" />;
    case "triangle":
      return (
        <span
          className="inline-block h-0 w-0"
          style={{
            borderLeft: "3.5px solid transparent",
            borderRight: "3.5px solid transparent",
            borderBottom: "6px solid currentColor",
          }}
          aria-hidden="true"
        />
      );
    case "square":
      return <span className={`h-1.5 w-1.5 ${dotClass}`} aria-hidden="true" />;
    default:
      return <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />;
  }
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={`gap-1.5 ${config.className}`}>
      <StatusIndicator shape={config.shape} dotClass={config.dotClass} />
      {config.label}
    </Badge>
  );
}
