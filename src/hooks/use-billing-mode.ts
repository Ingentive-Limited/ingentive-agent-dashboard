"use client";

import { useState, useCallback } from "react";

export type BillingMode = "api" | "subscription";

const STORAGE_KEY = "ingentive-billing-mode";

/**
 * Default to "subscription". The vast majority of Claude Code users are on
 * a flat-rate Anthropic plan (Pro / Max / Teams), where per-token cost
 * doesn't apply — Anthropic charges the plan price regardless of how many
 * cache_read_input_tokens the user racks up. Showing a "$20,000 estimated
 * cost" by default is alarming and misleading for those users; they can
 * still opt-in to the API view if they're actually billed per-token.
 */
function load(): BillingMode {
  if (typeof window === "undefined") return "subscription";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "api" || v === "subscription") return v;
  } catch {
    // ignore
  }
  return "subscription";
}

export function useBillingMode() {
  const [mode, setMode] = useState<BillingMode>(load);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "api" ? "subscription" : "api";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const isApi = mode === "api";

  return { mode, toggle, isApi };
}
