"use client";

import { usePolling } from "@/hooks/use-polling";
import { useAwaitingNotifications } from "@/hooks/use-notifications";
import { OverviewCards } from "@/components/overview-cards";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import type { DashboardOverview, ClaudeSession } from "@/lib/types";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Bell } from "lucide-react";

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

function SessionRow({ session }: { session: ClaudeSession }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <StatusBadge status={session.status} />
        <div>
          <p className="text-sm font-medium">{session.projectName}</p>
          <p className="text-xs text-muted-foreground">
            PID {session.pid} &middot; {formatDuration(session.startedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {session.slug && (
          <span className="text-xs text-muted-foreground">
            {session.slug}
          </span>
        )}
        <Badge variant="secondary" className="text-xs">
          {session.entrypoint === "claude-desktop" ? "Desktop" : "CLI"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => openSession(session)}
          title="Open session in terminal"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = usePolling<DashboardOverview>("/api/overview", 5000);

  useAwaitingNotifications(data?.recentSessions);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const awaitingSessions = data.recentSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <OverviewCards data={data} />

      {awaitingSessions.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-lg">Awaiting Input</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {awaitingSessions.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {awaitingSessions.map((session) => (
                <div key={`awaiting-${session.sessionId}`}>
                  <SessionRow session={session} />
                  {session.lastMessage && (
                    <div className="ml-4 mt-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                      {session.lastMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions</p>
          ) : (
            <div className="space-y-3">
              {data.recentSessions
                .filter(
                  (s) =>
                    awaitingSessions.length === 0 ||
                    !awaitingSessions.some((a) => a.sessionId === s.sessionId)
                )
                .map((session) => (
                  <SessionRow key={`active-${session.sessionId}`} session={session} />
                ))}
            </div>
          )}
          {data.recentSessions.length > 0 && (
            <Link
              href="/sessions"
              className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground"
            >
              View all sessions &rarr;
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
