"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import React from "react";

/**
 * UI-level provider filter. Cowork sessions are part of the "Claude family"
 * (both are Anthropic) — they're folded into the "claude" filter rather than
 * exposed as a separate top-level option. Microsoft Scout and VS Code's
 * GitHub Copilot Chat are each surfaced as their own filter because the
 * vendor / tool is distinct from Claude Code + Cowork and from each other.
 * Each session still carries its own `session.provider` value (claude /
 * codex / cowork / scout / copilot) internally, which drives entrypoint
 * labels, conversation-viewer routing, and which actions are enabled
 * per-session.
 */
export type ProviderFilter = "all" | "claude" | "codex" | "scout" | "copilot";

const STORAGE_KEY = "ingentive-provider";

/**
 * Read the current provider from localStorage on the client. Includes the
 * "cowork" → "claude" migration for users on older versions.
 */
function readClientProvider(): ProviderFilter {
  if (typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (
      v === "all" ||
      v === "claude" ||
      v === "codex" ||
      v === "scout" ||
      v === "copilot"
    ) {
      return v;
    }
    // Migrate previous "cowork" selection: that value used to be a top-level
    // option and now lives under "claude".
    if (v === "cowork") return "claude";
  } catch {
    // ignore
  }
  return "all";
}

/**
 * Always returns "all" during SSR so the server-rendered HTML matches the
 * first client render. The client then re-renders with the real stored value
 * via useSyncExternalStore (no hydration warning, because that hook
 * intentionally does a second render after hydration).
 */
function getServerProvider(): ProviderFilter {
  return "all";
}

// Module-level subscriber set so any consumer hook re-renders when the
// provider is mutated, regardless of which React tree it lives in.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  listeners.forEach((l) => l());
}

interface ProviderContextValue {
  provider: ProviderFilter;
  setProvider: (next: ProviderFilter) => void;
  isClaude: boolean;
  isCodex: boolean;
  isScout: boolean;
  isCopilot: boolean;
  isAll: boolean;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

export function ProviderProvider({ children }: { children: ReactNode }) {
  const provider = useSyncExternalStore<ProviderFilter>(
    subscribe,
    readClientProvider,
    getServerProvider
  );

  const setProvider = useCallback((next: ProviderFilter) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    notify();
  }, []);

  const value: ProviderContextValue = {
    provider,
    setProvider,
    isClaude: provider === "claude",
    isCodex: provider === "codex",
    isScout: provider === "scout",
    isCopilot: provider === "copilot",
    isAll: provider === "all",
  };

  return React.createElement(ProviderContext.Provider, { value }, children);
}

export function useProvider(): ProviderContextValue {
  const ctx = useContext(ProviderContext);
  if (!ctx) {
    throw new Error("useProvider must be used within a ProviderProvider");
  }
  return ctx;
}
