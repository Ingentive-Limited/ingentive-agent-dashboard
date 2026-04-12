"use client";

import { useState } from "react";
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
import { ChevronDown, ChevronRight, History, AlertCircle } from "lucide-react";

function ConversationPreview({ sessionId }: { sessionId: string }) {
  const { data: messages } = usePolling<ConversationMessage[]>(
    `/api/sessions/preview?id=${sessionId}`,
    0 // no polling, one-time fetch
  );
  const { data: errors } = usePolling<string[]>(
    `/api/sessions/errors?id=${sessionId}`,
    0
  );

  if (!messages) return <div className="p-4"><Skeleton className="h-20" /></div>;

  return (
    <div className="p-4 space-y-3">
      {errors && errors.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-500 mb-2">
            <AlertCircle className="h-4 w-4" />
            Errors ({errors.length})
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {errors.slice(-5).map((err, i) => (
              <p key={i} className="text-xs text-red-400 font-mono">{err}</p>
            ))}
          </div>
        </div>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages found</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
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
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Session History</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Session History</h1>
        <span className="text-sm text-muted-foreground">
          {history.length} sessions
        </span>
      </div>

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No session history found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
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
                <>
                  <TableRow
                    key={session.sessionId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpand(session.sessionId)}
                  >
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
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
                    <TableRow key={`preview-${session.sessionId}`}>
                      <TableCell colSpan={isApi ? 8 : 7} className="p-0">
                        <ConversationPreview sessionId={session.sessionId} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
