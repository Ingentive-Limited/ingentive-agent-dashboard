"use client";

import { usePolling } from "@/hooks/use-polling";
import { useAwaitingNotifications, useNotificationPermission } from "@/hooks/use-notifications";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, ExternalLink } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import type { ClaudeSession } from "@/lib/types";
import { useState, useEffect } from "react";

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

export default function AwaitingPage() {
  const { data: sessions, isLoading } = usePolling<ClaudeSession[]>(
    "/api/sessions",
    3000
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const { request, isGranted } = useNotificationPermission();

  useAwaitingNotifications(sessions);

  useEffect(() => {
    setNotificationsEnabled(isGranted());
  }, [isGranted]);

  const enableNotifications = async () => {
    const granted = await request();
    setNotificationsEnabled(granted);
  };

  const awaitingSessions = sessions?.filter(
    (s) =>
      s.isAlive &&
      (s.status === "awaiting_input" || s.status === "needs_attention")
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Awaiting Input</h1>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Awaiting Input</h1>
          <p className="text-sm text-muted-foreground">
            Sessions waiting for your response
          </p>
        </div>
        <Button
          variant={notificationsEnabled ? "secondary" : "default"}
          size="sm"
          onClick={enableNotifications}
          className="gap-2"
        >
          {notificationsEnabled ? (
            <>
              <Bell className="h-4 w-4" />
              Notifications On
            </>
          ) : (
            <>
              <BellOff className="h-4 w-4" />
              Enable Notifications
            </>
          )}
        </Button>
      </div>

      {!awaitingSessions || awaitingSessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No sessions awaiting input</p>
            <p className="text-xs text-muted-foreground mt-1">
              You&apos;ll be notified when a session needs your attention
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {awaitingSessions.map((session) => (
            <Card
              key={session.sessionId}
              className={
                session.status === "needs_attention"
                  ? "border-red-500/50"
                  : "border-amber-500/50"
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={session.status} />
                    <CardTitle className="text-base">
                      {session.projectName}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {session.entrypoint === "claude-desktop"
                        ? "Desktop"
                        : "CLI"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      PID {session.pid}
                    </span>
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
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>Running for {formatDuration(session.startedAt)}</span>
                    {session.slug && (
                      <span className="font-mono text-xs">
                        {session.slug}
                      </span>
                    )}
                  </div>
                  {session.lastMessage && (
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      {session.lastMessage}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground font-mono">
                    {session.cwd}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
