"use client";

import { useEffect, useRef } from "react";
import type { ClaudeSession } from "@/lib/types";

export function useNotificationPermission() {
  const request = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  };

  const isGranted = () => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    return Notification.permission === "granted";
  };

  return { request, isGranted };
}

export function useAwaitingNotifications(sessions: ClaudeSession[] | undefined) {
  const prevAwaitingRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!sessions) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const currentAwaiting = new Set(
      sessions
        .filter(
          (s) =>
            s.isAlive &&
            (s.status === "awaiting_input" || s.status === "needs_attention")
        )
        .map((s) => s.sessionId)
    );

    // Skip first render - just initialize the set without notifying
    if (prevAwaitingRef.current === null) {
      prevAwaitingRef.current = currentAwaiting;
      return;
    }

    // Only notify for newly appeared awaiting sessions
    if (Notification.permission === "granted") {
      for (const sessionId of currentAwaiting) {
        if (!prevAwaitingRef.current.has(sessionId)) {
          const session = sessions.find((s) => s.sessionId === sessionId);
          if (session) {
            const title =
              session.status === "needs_attention"
                ? "Claude needs your input"
                : "Claude is waiting";
            const body = `${session.projectName} (${session.entrypoint === "claude-desktop" ? "Desktop" : "CLI"})${
              session.lastMessage
                ? `\n${session.lastMessage.slice(0, 100)}`
                : ""
            }`;
            new Notification(title, { body, icon: "/ingentive-logo-dark.svg" });
          }
        }
      }
    }

    prevAwaitingRef.current = currentAwaiting;
  }, [sessions]);
}
