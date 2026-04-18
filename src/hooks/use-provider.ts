"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import React from "react";

export type ProviderFilter = "all" | "claude" | "codex";

const STORAGE_KEY = "ingentive-provider";

function load(): ProviderFilter {
  if (typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "all" || v === "claude" || v === "codex") return v;
  } catch {
    // ignore
  }
  return "all";
}

interface ProviderContextValue {
  provider: ProviderFilter;
  setProvider: (next: ProviderFilter) => void;
  isClaude: boolean;
  isCodex: boolean;
  isAll: boolean;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

export function ProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProviderState] = useState<ProviderFilter>(load);

  const setProvider = useCallback((next: ProviderFilter) => {
    setProviderState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value: ProviderContextValue = {
    provider,
    setProvider,
    isClaude: provider === "claude",
    isCodex: provider === "codex",
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
