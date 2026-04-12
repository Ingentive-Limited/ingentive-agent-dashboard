"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ClaudeSession } from "@/lib/types";

export interface NotificationPreferences {
  enabled: boolean;
  sound: boolean;
  awaitingInput: boolean;
  needsAttention: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  sound: true,
  awaitingInput: true,
  needsAttention: true,
};

const PREFS_KEY = "ingentive-notification-prefs";

function loadPrefs(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

function savePrefs(prefs: NotificationPreferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(loadPrefs);

  const update = useCallback((partial: Partial<NotificationPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      savePrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}

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

    const prefs = loadPrefs();
    if (!prefs.enabled) return;

    const currentAwaiting = new Set(
      sessions
        .filter((s) => {
          if (!s.isAlive) return false;
          if (s.status === "awaiting_input" && prefs.awaitingInput) return true;
          if (s.status === "needs_attention" && prefs.needsAttention) return true;
          return false;
        })
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

            if (prefs.sound) {
              try {
                const audio = new Audio("/notification.mp3");
                audio.volume = 0.3;
                audio.play().catch(() => {});
              } catch {
                // ignore - sound file may not exist
              }
            }
          }
        }
      }
    }

    prevAwaitingRef.current = currentAwaiting;
  }, [sessions]);
}
