"use client";

import { usePolling } from "@/hooks/use-polling";
import { useAwaitingNotifications } from "@/hooks/use-notifications";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { OverviewCards } from "@/components/overview-cards";
import { TokenChart } from "@/components/token-chart";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import type { DashboardOverview, ClaudeSession } from "@/lib/types";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Bell, ArrowRight, CreditCard, Key } from "lucide-react";

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
  const { mode, toggle, isApi } = useBillingMode();

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
          title={isApi ? "Using API tokens (costs tracked)" : "Using subscription (no token costs)"}
        >
          {isApi ? (
            <>
              <Key className="h-3.5 w-3.5" />
              API
            </>
          ) : (
            <>
              <CreditCard className="h-3.5 w-3.5" />
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
              <Bell className={`h-4 w-4 ${awaitingSessions.length > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
              <CardTitle className="text-lg">Awaiting Input</CardTitle>
              {awaitingSessions.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {awaitingSessions.length}
                </Badge>
              )}
            </div>
            <Link href="/awaiting">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
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
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openSession(session)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Resume
                    </Button>
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

      {data.tokenTimeSeries.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Token Usage</CardTitle>
              <Link href="/tokens">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  Details <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <TokenChart data={data.tokenTimeSeries} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
