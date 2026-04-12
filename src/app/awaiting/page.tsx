"use client";

import { useState, useEffect, useRef } from "react";
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
import { Bell, BellOff, ExternalLink, Settings2, Square, MessageSquare } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import type { ClaudeSession } from "@/lib/types";
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

function NotificationSettings() {
  const { prefs, update } = useNotificationPreferences();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Focus trap and Escape handler
  useEffect(() => {
    if (!open || !dialogRef.current) return;

    // Move focus into the dialog
    const firstFocusable = dialogRef.current.querySelector<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Trap focus within the dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // Close on click outside
    function handleClickOutside(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(!open)}
        aria-label="Notification settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notification settings"
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <Card
          ref={dialogRef}
          className="absolute right-0 top-full mt-1 z-10 w-64"
          role="dialog"
          aria-modal="true"
          aria-label="Notification settings"
        >
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" id="notif-settings-title">Notification Settings</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close notification settings"
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
      )}
    </>
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
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [viewingSession, setViewingSession] = useState<ClaudeSession | null>(null);

  useAwaitingNotifications(sessions);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const handleNotificationToggle = async () => {
    if (browserPermission !== "granted") {
      const granted = await request();
      setBrowserPermission(granted ? "granted" : "denied");
      if (granted) {
        update({ enabled: true });
      }
    } else {
      update({ enabled: !prefs.enabled });
    }
  };

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

  const notificationsActive = browserPermission === "granted" && prefs.enabled;

  const awaitingSessions = sessions?.filter(
    (s) =>
      s.isAlive &&
      (s.status === "awaiting_input" || s.status === "needs_attention")
  );

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading awaiting input sessions">
        <h1 className="text-2xl font-bold">Awaiting Input</h1>
        <Skeleton className="h-64" />
        <span className="sr-only">Loading awaiting input sessions...</span>
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
                <Bell className="h-4 w-4" aria-hidden="true" />
                Notifications On
              </>
            ) : (
              <>
                <BellOff className="h-4 w-4" aria-hidden="true" />
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
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground/30 mb-4" aria-hidden="true" />
            <p className="text-muted-foreground font-medium">No sessions awaiting input</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              You&apos;ll be notified when a session needs your attention.
              Sessions appear here when Claude finishes a turn and is waiting for your response.
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
