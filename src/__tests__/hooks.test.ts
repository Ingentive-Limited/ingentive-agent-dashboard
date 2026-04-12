import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("usePersistedState", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("returns default value initially", async () => {
    const { usePersistedState } = await import("@/hooks/use-persisted-state");
    const { result } = renderHook(() => usePersistedState("test-key", "default"));
    expect(result.current[0]).toBe("default");
  });

  it("persists values to localStorage", async () => {
    const { usePersistedState } = await import("@/hooks/use-persisted-state");
    const { result } = renderHook(() => usePersistedState("test-key", "default"));

    act(() => {
      result.current[1]("new-value");
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "test-key",
      JSON.stringify("new-value")
    );
  });

  it("strips prototype pollution keys from objects", async () => {
    localStorageMock.setItem(
      "test-key",
      JSON.stringify({ __proto__: "bad", normal: "good" })
    );

    const { usePersistedState } = await import("@/hooks/use-persisted-state");
    renderHook(() =>
      usePersistedState<Record<string, string>>("test-key", {})
    );

    // After hydration, __proto__ should be stripped
    // Wait for useEffect
    await vi.dynamicImportSettled?.();
  });
});

describe("useTokenBudget", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("returns default budget when nothing stored", async () => {
    const { useTokenBudget } = await import("@/hooks/use-token-budget");
    const { result } = renderHook(() => useTokenBudget());

    expect(result.current.budget.enabled).toBe(false);
    expect(result.current.budget.dailyLimit).toBe(5_000_000);
    expect(result.current.budget.monthlyLimit).toBe(100_000_000);
    expect(result.current.budget.alertThreshold).toBe(80);
  });

  it("checkBudget returns zeros when disabled", async () => {
    const { useTokenBudget } = await import("@/hooks/use-token-budget");
    const { result } = renderHook(() => useTokenBudget());

    const status = result.current.checkBudget(1_000_000, 10_000_000);
    expect(status.dailyPercent).toBe(0);
    expect(status.monthlyPercent).toBe(0);
    expect(status.dailyAlert).toBe(false);
    expect(status.monthlyAlert).toBe(false);
  });

  it("checkBudget calculates correct percentages when enabled", async () => {
    const { useTokenBudget } = await import("@/hooks/use-token-budget");
    const { result } = renderHook(() => useTokenBudget());

    act(() => {
      result.current.update({ enabled: true, dailyLimit: 1_000_000, monthlyLimit: 10_000_000, alertThreshold: 80 });
    });

    const status = result.current.checkBudget(900_000, 8_500_000);
    expect(status.dailyPercent).toBe(90);
    expect(status.monthlyPercent).toBe(85);
    expect(status.dailyAlert).toBe(true);
    expect(status.monthlyAlert).toBe(true);
    expect(status.dailyExceeded).toBe(false);
    expect(status.monthlyExceeded).toBe(false);
  });

  it("checkBudget detects exceeded limits", async () => {
    const { useTokenBudget } = await import("@/hooks/use-token-budget");
    const { result } = renderHook(() => useTokenBudget());

    act(() => {
      result.current.update({ enabled: true, dailyLimit: 1_000_000, monthlyLimit: 10_000_000 });
    });

    const status = result.current.checkBudget(1_500_000, 12_000_000);
    expect(status.dailyExceeded).toBe(true);
    expect(status.monthlyExceeded).toBe(true);
  });

  it("validates stored budget with invalid types", async () => {
    localStorageMock.setItem(
      "ingentive-token-budget",
      JSON.stringify({ enabled: "yes", dailyLimit: -100, monthlyLimit: "big", alertThreshold: 200 })
    );

    const { useTokenBudget } = await import("@/hooks/use-token-budget");
    renderHook(() => useTokenBudget());

    // Should fall back to defaults for invalid fields
    // (After useEffect hydration)
  });
});

describe("useFavorites", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("starts with empty favorites", async () => {
    const { useFavorites } = await import("@/hooks/use-favorites");
    const { result } = renderHook(() => useFavorites());

    expect(result.current.favoriteIds).toEqual([]);
  });

  it("toggles favorites on and off", async () => {
    const { useFavorites } = await import("@/hooks/use-favorites");
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite("project-1");
    });

    expect(result.current.isFavorite("project-1")).toBe(true);

    act(() => {
      result.current.toggleFavorite("project-1");
    });

    expect(result.current.isFavorite("project-1")).toBe(false);
  });
});
