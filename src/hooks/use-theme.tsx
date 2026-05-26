"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

/**
 * Minimal theme provider — replaces `next-themes`, which renders a `<script>`
 * tag inside a Client Component and trips React 19's dev-mode warning
 * ("Encountered a script tag while rendering React component").
 *
 * Strategy:
 *  - A server-rendered inline script in <head> (see `themeBootstrapScript`)
 *    sets the initial `class` on <html> based on `localStorage` and the user's
 *    OS color-scheme preference. This runs *before* React hydrates, so there's
 *    no flash of incorrect theme.
 *  - This client hook just exposes the current theme + a setter that updates
 *    both <html class=…> and localStorage.
 *
 * Storage key matches the one previously used by next-themes so an existing
 * user's theme choice survives the migration.
 */

type Theme = "light" | "dark";
const STORAGE_KEY = "theme";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Inline-script body, injected once in <head> by layout.tsx before React
 * hydrates. The content is a static literal defined here — no untrusted
 * input is ever interpolated into it.
 */
export const themeBootstrapScript = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var c = document.documentElement.classList;
    c.remove("light", "dark");
    c.add(theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    // localStorage / matchMedia not available — fall through to the
    // default class on <html> in layout.tsx.
  }
})();
`.trim();

/** Read the current theme class from <html>; defaults to "dark". */
function readCurrentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/** Always returns "dark" during SSR so server + client first render match. */
function getServerTheme(): Theme {
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Track a "version" counter that we bump whenever we mutate the html
  // class. useSyncExternalStore re-reads the snapshot when listeners are
  // notified, so this is the bridge between our imperative class change and
  // React's render cycle.
  const listenersRef = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const theme = useSyncExternalStore<Theme>(
    subscribe,
    readCurrentTheme,
    getServerTheme
  );

  const setTheme = useCallback((next: Theme) => {
    const c = document.documentElement.classList;
    c.remove("light", "dark");
    c.add(next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — non-persisting setting is still acceptable
    }
    // Notify subscribers that the snapshot has changed.
    listenersRef.current.forEach((listener) => listener());
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme: theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook for reading/setting the active theme. Returns a shape compatible with
 * the previous `next-themes` usage so existing call sites work unchanged:
 * `{ theme, resolvedTheme, setTheme }`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // We're rendered outside a ThemeProvider — return safe defaults instead
    // of throwing so a misconfigured page still renders something usable.
    return {
      theme: "dark",
      resolvedTheme: "dark",
      setTheme: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
