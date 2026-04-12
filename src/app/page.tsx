"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useAwaitingNotifications } from "@/hooks/use-notifications";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { OverviewCards } from "@/components/overview-cards";
import { TokenChart } from "@/components/token-chart";
import { TokenBudgetCard } from "@/components/token-budget";
import { StatusBadge } from "@/components/status-badge";
import { ConversationViewer } from "@/components/conversation-viewer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import type { DashboardOverview, ClaudeSession } from "@/lib/types";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  Bell,
  ArrowRight,
  CreditCard,
  Key,
  Square,
  MessageSquare,
} from "lucide-react";

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

function SessionRow({
  session,
  onKill,
  killingPids,
  onViewConversation,
}: {
  session: ClaudeSession;
  onKill: (pid: number) => void;
  killingPids: Set<number>;
  onViewConversation: (session: ClaudeSession) => void;
}) {
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
          onClick={() => onViewConversation(session)}
          aria-label={`View conversation for ${session.projectName}`}
          title="View conversation"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
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
        {session.isAlive && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onKill(session.pid)}
            disabled={killingPids.has(session.pid)}
            aria-label={`Stop ${session.projectName} session`}
            title="Stop session"
          >
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = usePolling<DashboardOverview>("/api/overview", 5000);
  const { toggle, isApi } = useBillingMode();
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [viewingSession, setViewingSession] = useState<ClaudeSession | null>(null);

  useAwaitingNotifications(data?.recentSessions);

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

  if (isLoading || !data) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading dashboard">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
        <span className="sr-only">Loading dashboard content...</span>
      </div>
    );
  }

  const awaitingSessions = data.recentSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  );

  const nonAwaitingSessions = data.recentSessions.filter(
    (s) => s.status !== "awaiting_input" && s.status !== "needs_attention"
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          onClick={toggle}
          aria-label={isApi ? "Billing mode: API tokens. Click to switch to subscription" : "Billing mode: Subscription. Click to switch to API"}
          title={isApi ? "Using API tokens (costs tracked)" : "Using subscription (no token costs)"}
        >
          {isApi ? (
            <>
              <Key className="h-3.5 w-3.5" aria-hidden="true" />
              API
            </>
          ) : (
            <>
              <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
              Subscription
            </>
          )}
        </Button>
      </div>

      <OverviewCards data={data} showCost={isApi} />

      <Card className={awaitingSessions.length > 0 ? "border-amber-500/50" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className={`h-4 w-4 ${awaitingSessions.length > 0 ? "text-amber-500" : "text-muted-foreground"}`} aria-hidden="true" />
              <CardTitle className="text-lg">Awaiting Input</CardTitle>
              {awaitingSessions.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <span className="sr-only">Count: </span>{awaitingSessions.length}
                </Badge>
              )}
            </div>
            <Link href="/awaiting">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div aria-live="polite">
            {awaitingSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions awaiting input</p>
            ) : (
              <div className="space-y-3">
                {awaitingSessions.map((session) => (
                  <div key={`awaiting-${session.sessionId}`} className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg border border-amber-500/30 p-3 bg-amber-500/5">
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
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => openSession(session)}
                          aria-label={`Resume ${session.projectName} session in terminal`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Resume
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
                      </div>
                    </div>
                    {session.lastMessage && (
                      <div className="ml-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                        {session.lastMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {nonAwaitingSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other active sessions</p>
          ) : (
            <div className="space-y-3">
              {nonAwaitingSessions.map((session) => (
                <SessionRow
                  key={`active-${session.sessionId}`}
                  session={session}
                  onKill={handleKill}
                  killingPids={killingPids}
                  onViewConversation={setViewingSession}
                />
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

      {isApi && (
        <TokenBudgetCard
          dailyTokens={data.totalTokensToday}
          monthlyTokens={data.totalTokensMonth}
        />
      )}

      {data.tokenTimeSeries.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Token Usage</CardTitle>
              <Link href="/tokens">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  Details <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <TokenChart data={data.tokenTimeSeries} />
          </CardContent>
        </Card>
      )}

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
