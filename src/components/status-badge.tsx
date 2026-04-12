"use client";

import { Badge } from "@/components/ui/badge";
import type { SessionStatus } from "@/lib/types";

const statusConfig: Record<
  SessionStatus,
  { label: string; className: string; dotClass: string }
> = {
  running: {
    label: "Running",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    dotClass: "bg-blue-500 animate-pulse",
  },
  awaiting_input: {
    label: "Awaiting Input",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    dotClass: "bg-amber-500 animate-pulse",
  },
  needs_attention: {
    label: "Needs Attention",
    className: "bg-red-500/10 text-red-500 border-red-500/20",
    dotClass: "bg-red-500 animate-pulse",
  },
  processing: {
    label: "Processing",
    className: "bg-green-500/10 text-green-500 border-green-500/20",
    dotClass: "bg-green-500 animate-pulse",
  },
  idle: {
    label: "Idle",
    className: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  dead: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground/50",
  },
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={`gap-1.5 ${config.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </Badge>
  );
}
