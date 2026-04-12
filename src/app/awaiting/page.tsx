"use client";

import { usePolling } from "@/hooks/use-polling";
import {
  useAwaitingNotifications,
  useNotificationPermission,
  useNotificationPreferences,
} from "@/hooks/use-notifications";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, ExternalLink, Settings2 } from "lucide-react";
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

function NotificationSettings() {
  const { prefs, update } = useNotificationPreferences();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(true)}
        title="Notification settings"
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Card className="absolute right-0 top-full mt-1 z-10 w-64">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Notification Settings</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm">Sound</span>
          <input
            type="checkbox"
            checked={prefs.sound}
            onChange={(e) => update({ sound: e.target.checked })}
            className="accent-primary h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm">Awaiting input</span>
          <input
            type="checkbox"
            checked={prefs.awaitingInput}
            onChange={(e) => update({ awaitingInput: e.target.checked })}
            className="accent-primary h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm">Needs attention</span>
          <input
            type="checkbox"
            checked={prefs.needsAttention}
            onChange={(e) => update({ needsAttention: e.target.checked })}
            className="accent-primary h-4 w-4"
          />
        </label>
      </CardContent>
    </Card>
  );
}

export default function AwaitingPage() {
  const { data: sessions, isLoading } = usePolling<ClaudeSession[]>(
    "/api/sessions",
    3000
  );
  const [browserPermission, setBrowserPermission] = useState<"default" | "granted" | "denied">("default");
  const { request } = useNotificationPermission();
  const { prefs, update } = useNotificationPreferences();

  useAwaitingNotifications(sessions);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const handleNotificationToggle = async () => {
    if (browserPermission !== "granted") {
      // Need to request browser permission first
      const granted = await request();
      setBrowserPermission(granted ? "granted" : "denied");
      if (granted) {
        update({ enabled: true });
      }
    } else {
      // Browser permission already granted, toggle our preference
      update({ enabled: !prefs.enabled });
    }
  };

  const notificationsActive = browserPermission === "granted" && prefs.enabled;

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
        <div className="relative flex items-center gap-2">
          <Button
            variant={notificationsActive ? "secondary" : "default"}
            size="sm"
            onClick={handleNotificationToggle}
            className="gap-2"
          >
            {notificationsActive ? (
              <>
                <Bell className="h-4 w-4" />
                Notifications On
              </>
            ) : (
              <>
                <BellOff className="h-4 w-4" />
                {browserPermission === "denied"
                  ? "Notifications Blocked"
                  : browserPermission === "granted"
                    ? "Notifications Off"
                    : "Enable Notifications"}
              </>
            )}
          </Button>
          {browserPermission === "granted" && <NotificationSettings />}
        </div>
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
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openSession(session)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Resume
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
