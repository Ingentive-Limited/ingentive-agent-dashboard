"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useAwaitingNotifications } from "@/hooks/use-notifications";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { useProvider } from "@/hooks/use-provider";
import dynamic from "next/dynamic";
import { OverviewCards } from "@/components/overview-cards";
const TokenChart = dynamic(() => import("@/components/token-chart").then((m) => m.TokenChart), {
  ssr: false,
  loading: () => <div className="h-[350px] w-full animate-pulse rounded-md bg-muted/30" />,
});
import { TokenBudgetCard } from "@/components/token-budget";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { StatusBadge } from "@/components/status-badge";
import { ConversationViewer } from "@/components/conversation-viewer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDuration, formatEntrypoint } from "@/lib/utils";
import type { DashboardOverview, ClaudeSession, DailyTokenUsage } from "@/lib/types";
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
      provider: session.provider,
    }),
  });
}

function killSession(pid: number, provider?: string): Promise<boolean> {
  return fetch("/api/sessions/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid, provider }),
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
          {formatEntrypoint(session.entrypoint)}
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
  const { provider } = useProvider();
  const { data, isLoading } = usePolling<DashboardOverview>(`/api/overview?provider=${provider}`, 5000);
  const { data: dailyData } = usePolling<DailyTokenUsage[]>(`/api/tokens/daily?days=140&provider=${provider}`, 30000);
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
        <div className="flex items-center gap-2">
          {/*
            Billing-mode hint: prompt-caching on Anthropic models can rack up
            multi-billion-token totals, which look terrifying when displayed
            as a per-token API price ($20K+ on a heavy Cowork user) but are
            meaningless if the user is on a Pro / Max / Teams subscription
            that charges a flat monthly fee. The toggle controls whether the
            cost card is shown at all; this label makes the current mode and
            its implication explicit so a subscription user doesn't have to
            decode a tiny icon button to understand why their "estimated
            cost" suddenly says $20,000.
          */}
          <span className="text-xs text-muted-foreground">
            {isApi
              ? "Showing API-equivalent cost"
              : "Subscription mode — costs hidden"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            onClick={toggle}
            aria-label={isApi ? "Billing mode: API. Click to switch to subscription mode and hide cost figures." : "Billing mode: Subscription. Click to switch to API mode and show theoretical per-token cost."}
            title={isApi ? "Click to switch to Subscription mode (hides cost figures)" : "Click to switch to API mode (shows what this usage would cost if billed per-token)"}
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
              <p className="text-sm text-muted-foreground">All clear &mdash; no sessions waiting for your response</p>
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
            <p className="text-sm text-muted-foreground">
              No active sessions. Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{provider === "codex" ? "codex" : provider === "claude" ? "claude" : "claude or codex"}</code> in a project directory to start one.
            </p>
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
              className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="View all sessions"
            >
              View all sessions
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {dailyData && dailyData.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityHeatmap data={dailyData} />
            </CardContent>
          </Card>
        )}

        {isApi ? (
          <TokenBudgetCard
            dailyTokens={data.totalTokensToday}
            monthlyTokens={data.totalTokensMonth}
          />
        ) : (
          /* Placeholder so the grid stays balanced when budget card is hidden */
          dailyData && dailyData.length > 0 ? <div /> : null
        )}
      </div>

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
          providerName={
            viewingSession.provider === "codex"
              ? "Codex"
              : viewingSession.provider === "scout"
              ? "Scout"
              : viewingSession.provider === "copilot"
              ? "Copilot"
              : "Claude"
          }
          provider={viewingSession.provider}
        />
      )}
    </div>
  );
}
