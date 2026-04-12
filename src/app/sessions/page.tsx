"use client";

import { useState, useMemo } from "react";
import { usePolling } from "@/hooks/use-polling";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/lib/utils";
import type { ClaudeSession } from "@/lib/types";
import { ExternalLink, Square, MessageSquare, CheckSquare, XSquare } from "lucide-react";
import { ConversationViewer } from "@/components/conversation-viewer";

function openSession(session: ClaudeSession) {
  fetch("/api/sessions/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: session.sessionId,
      cwd: session.cwd,
      entrypoint: session.entrypoint,
    }),
  });
}

function killSession(pid: number): Promise<boolean> {
  return fetch("/api/sessions/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid }),
  }).then((r) => r.ok);
}

export default function SessionsPage() {
  const { data: sessions, isLoading } = usePolling<ClaudeSession[]>(
    "/api/sessions",
    5000
  );
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [viewingSession, setViewingSession] = useState<ClaudeSession | null>(null);
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());

  const aliveSessions = useMemo(
    () => (sessions || []).filter((s) => s.isAlive),
    [sessions]
  );

  const handleKill = async (pid: number) => {
    setKillingPids((prev) => new Set(prev).add(pid));
    await killSession(pid);
    setTimeout(() => {
      setKillingPids((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    }, 2000);
  };

  const handleBulkKill = async () => {
    const pids = Array.from(selectedPids);
    setKillingPids((prev) => {
      const next = new Set(prev);
      pids.forEach((p) => next.add(p));
      return next;
    });
    await Promise.all(pids.map((pid) => killSession(pid)));
    setTimeout(() => {
      setKillingPids((prev) => {
        const next = new Set(prev);
        pids.forEach((p) => next.delete(p));
        return next;
      });
      setSelectedPids(new Set());
    }, 2000);
  };

  const toggleSelect = (pid: number) => {
    setSelectedPids((prev) => {
      const next = new Set(prev);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedPids.size === aliveSessions.length) {
      setSelectedPids(new Set());
    } else {
      setSelectedPids(new Set(aliveSessions.map((s) => s.pid)));
    }
  };

  if (isLoading || !sessions) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const hasSelection = selectedPids.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <span className="text-sm text-muted-foreground">
          {aliveSessions.length} active
        </span>
      </div>

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selectedPids.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={handleBulkKill}
            disabled={killingPids.size > 0}
          >
            <XSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Stop selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedPids(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table aria-label="Active sessions">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {aliveSessions.length > 0 && (
                  <button
                    type="button"
                    onClick={selectAll}
                    className="flex items-center justify-center"
                    aria-label={selectedPids.size === aliveSessions.length ? "Deselect all" : "Select all"}
                  >
                    <CheckSquare
                      className={`h-4 w-4 ${
                        selectedPids.size === aliveSessions.length && aliveSessions.length > 0
                          ? "text-primary"
                          : "text-muted-foreground/40"
                      }`}
                    />
                  </button>
                )}
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>PID</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Entrypoint</TableHead>
              <TableHead>Working Directory</TableHead>
              <TableHead className="w-28"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No sessions found
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => (
                <TableRow
                  key={session.sessionId}
                  className={selectedPids.has(session.pid) ? "bg-primary/5" : ""}
                >
                  <TableCell>
                    {session.isAlive && (
                      <input
                        type="checkbox"
                        checked={selectedPids.has(session.pid)}
                        onChange={() => toggleSelect(session.pid)}
                        className="accent-primary h-4 w-4"
                        aria-label={`Select ${session.projectName} session`}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={session.status} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {session.pid}
                  </TableCell>
                  <TableCell className="font-medium">
                    {session.projectName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(session.startedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {session.entrypoint === "claude-desktop" ? "Desktop" : "CLI"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground font-mono">
                    {session.cwd}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setViewingSession(session)}
                        aria-label={`View conversation for ${session.projectName}`}
                        title="View conversation"
                      >
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      {session.isAlive && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openSession(session)}
                            aria-label={`Open ${session.projectName} session in terminal`}
                            title="Open session in terminal"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleKill(session.pid)}
                            disabled={killingPids.has(session.pid)}
                            aria-label={`Stop ${session.projectName} session`}
                            title="Stop session"
                          >
                            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {viewingSession && (
        <ConversationViewer
          sessionId={viewingSession.sessionId}
          projectName={viewingSession.projectName}
          open={!!viewingSession}
          onOpenChange={(open) => {
            if (!open) setViewingSession(null);
          }}
        />
      )}
    </div>
  );
}
