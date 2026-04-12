"use client";

import { useState, useEffect, useCallback } from "react";

export type BillingMode = "api" | "subscription";

const STORAGE_KEY = "ingentive-billing-mode";

function load(): BillingMode {
  if (typeof window === "undefined") return "api";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "api" || v === "subscription") return v;
  } catch {
    // ignore
  }
  return "api";
}

export function useBillingMode() {
  const [mode, setMode] = useState<BillingMode>("api");

  useEffect(() => {
    setMode(load());
  }, []);

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
