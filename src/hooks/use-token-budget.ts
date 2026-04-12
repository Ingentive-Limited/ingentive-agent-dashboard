"use client";

import { useState, useEffect, useCallback } from "react";

export interface TokenBudget {
  enabled: boolean;
  dailyLimit: number;      // tokens per day
  monthlyLimit: number;    // tokens per month
  alertThreshold: number;  // percentage (0-100) at which to show warning
}

const STORAGE_KEY = "ingentive-token-budget";

const DEFAULT_BUDGET: TokenBudget = {
  enabled: false,
  dailyLimit: 5_000_000,
  monthlyLimit: 100_000_000,
  alertThreshold: 80,
};

function loadBudget(): TokenBudget {
  if (typeof window === "undefined") return DEFAULT_BUDGET;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BUDGET;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BUDGET, ...parsed };
  } catch {
    return DEFAULT_BUDGET;
  }
}

export interface BudgetStatus {
  dailyUsed: number;
  monthlyUsed: number;
  dailyPercent: number;
  monthlyPercent: number;
  dailyAlert: boolean;
  monthlyAlert: boolean;
  dailyExceeded: boolean;
  monthlyExceeded: boolean;
}

export function useTokenBudget() {
  const [budget, setBudget] = useState<TokenBudget>(DEFAULT_BUDGET);

  useEffect(() => {
    setBudget(loadBudget());
  }, []);

  const update = useCallback((partial: Partial<TokenBudget>) => {
    setBudget((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const checkBudget = useCallback(
    (dailyUsed: number, monthlyUsed: number): BudgetStatus => {
      if (!budget.enabled) {
        return {
          dailyUsed,
          monthlyUsed,
          dailyPercent: 0,
          monthlyPercent: 0,
          dailyAlert: false,
          monthlyAlert: false,
          dailyExceeded: false,
          monthlyExceeded: false,
        };
      }

      const dailyPercent = budget.dailyLimit > 0
        ? (dailyUsed / budget.dailyLimit) * 100
        : 0;
      const monthlyPercent = budget.monthlyLimit > 0
        ? (monthlyUsed / budget.monthlyLimit) * 100
        : 0;

      return {
        dailyUsed,
        monthlyUsed,
        dailyPercent,
        monthlyPercent,
        dailyAlert: dailyPercent >= budget.alertThreshold,
        monthlyAlert: monthlyPercent >= budget.alertThreshold,
        dailyExceeded: dailyPercent >= 100,
        monthlyExceeded: monthlyPercent >= 100,
      };
    },
    [budget]
  );

  return { budget, update, checkBudget };
}
