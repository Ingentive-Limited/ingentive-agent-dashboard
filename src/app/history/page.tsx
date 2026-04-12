"use client";

import { Fragment, useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "@/lib/utils";
import type { SessionHistory, ConversationMessage } from "@/lib/types";
import { ChevronDown, ChevronRight, History, AlertCircle, Download } from "lucide-react";
import { exportCSV, exportJSON } from "@/lib/export";

function ConversationPreview({ sessionId }: { sessionId: string }) {
  const { data: messages } = usePolling<ConversationMessage[]>(
    `/api/sessions/preview?id=${sessionId}`,
    0 // no polling, one-time fetch
  );
  const { data: errors } = usePolling<string[]>(
    `/api/sessions/errors?id=${sessionId}`,
    0
  );

  if (!messages) return <div className="p-4" role="status"><Skeleton className="h-20" /><span className="sr-only">Loading conversation...</span></div>;

  return (
    <div className="p-4 space-y-3">
      {errors && errors.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium text-red-500 mb-2">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            Errors ({errors.length})
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto" tabIndex={0} role="log" aria-label="Error messages">
            {errors.slice(-5).map((err, i) => (
              <p key={i} className="text-xs text-red-400 font-mono">{err}</p>
            ))}
          </div>
        </div>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages found</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto" tabIndex={0} role="log" aria-label="Conversation messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-md p-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-500/10 border border-blue-500/20"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium capitalize">{msg.role}</span>
                {msg.timestamp && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelativeTime(msg.timestamp)}
                  </span>
                )}
                {msg.toolUses && msg.toolUses.length > 0 && (
                  <div className="flex gap-1">
                    {msg.toolUses.map((t, j) => (
                      <Badge key={j} variant="secondary" className="text-[10px] py-0">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs whitespace-pre-wrap">{msg.text || "(tool use only)"}</p>
              {msg.errors && msg.errors.length > 0 && (
                <div className="mt-1 space-y-1">
                  {msg.errors.map((err, j) => (
                    <p key={j} className="text-xs text-red-400 font-mono">{err}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const { data: history, isLoading } = usePolling<SessionHistory[]>(
    "/api/history",
    15000
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { isApi } = useBillingMode();

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading || !history) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading session history">
        <h1 className="text-2xl font-bold">Session History</h1>
        <Skeleton className="h-96" />
        <span className="sr-only">Loading session history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Session History</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {history.length} sessions
          </span>
          {history.length > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() =>
                  exportCSV(
                    history.map((h) => ({
                      sessionId: h.sessionId,
                      project: h.projectName,
                      status: h.status,
                      startedAt: new Date(h.startedAt).toISOString(),
                      messages: h.messageCount,
                      input_tokens: h.totalTokens.input_tokens,
                      output_tokens: h.totalTokens.output_tokens,
                      cost: h.cost.totalCost.toFixed(4),
                      cwd: h.cwd,
                    })),
                    "session-history.csv",
                    [
                      { key: "sessionId", label: "Session ID" },
                      { key: "project", label: "Project" },
                      { key: "status", label: "Status" },
                      { key: "startedAt", label: "Started" },
                      { key: "messages", label: "Messages" },
                      { key: "input_tokens", label: "Input Tokens" },
                      { key: "output_tokens", label: "Output Tokens" },
                      { key: "cost", label: "Cost (USD)" },
                      { key: "cwd", label: "Working Directory" },
                    ]
                  )
                }
                aria-label="Export session history as CSV"
                title="Export as CSV"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                CSV
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => exportJSON(history, "session-history.json")}
                aria-label="Export session history as JSON"
                title="Export as JSON"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                JSON
              </Button>
            </>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground/30 mb-4" aria-hidden="true" />
            <p className="text-muted-foreground">No session history found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Session history">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">Expand</span></TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Tokens</TableHead>
                {isApi && <TableHead>Cost</TableHead>}
                <TableHead>Entrypoint</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((session) => (
                <Fragment key={session.sessionId}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpand(session.sessionId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(session.sessionId);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={expanded.has(session.sessionId)}
                    aria-label={`${session.projectName} session — ${session.status}. Click to ${expanded.has(session.sessionId) ? "collapse" : "expand"} details.`}
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-hidden="true"
                        tabIndex={-1}
                      >
                        {expanded.has(session.sessionId) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={session.status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {session.projectName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDuration(session.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {session.messageCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTokens(
                        session.totalTokens.input_tokens +
                          session.totalTokens.output_tokens
                      )}
                    </TableCell>
                    {isApi && (
                      <TableCell className="font-mono text-sm">
                        {formatCost(session.cost.totalCost)}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {session.entrypoint === "claude-desktop" ? "Desktop" : "CLI"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {expanded.has(session.sessionId) && (
                    <TableRow>
                      <TableCell colSpan={isApi ? 8 : 7} className="p-0">
                        <ConversationPreview sessionId={session.sessionId} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
