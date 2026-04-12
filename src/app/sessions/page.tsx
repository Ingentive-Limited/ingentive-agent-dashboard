"use client";

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
import { ExternalLink } from "lucide-react";

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

export default function SessionsPage() {
  const { data: sessions, isLoading } = usePolling<ClaudeSession[]>(
    "/api/sessions",
    5000
  );

  if (isLoading || !sessions) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <span className="text-sm text-muted-foreground">
          {sessions.filter((s) => s.isAlive).length} active
        </span>
      </div>

      <div className="rounded-lg border">
        <Table aria-label="Active sessions">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>PID</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Entrypoint</TableHead>
              <TableHead>Working Directory</TableHead>
              <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No sessions found
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => (
                <TableRow key={session.sessionId}>
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
                    {session.isAlive && (
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
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
