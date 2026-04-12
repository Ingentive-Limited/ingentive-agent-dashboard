"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const NAV_ROUTES = [
  "/",          // ⌘1
  "/sessions",  // ⌘2
  "/awaiting",  // ⌘3
  "/projects",  // ⌘4
  "/tokens",    // ⌘5
  "/history",   // ⌘6
  "/tasks",     // ⌘7
];

/**
 * Global keyboard shortcuts:
 * - ⌘/Ctrl + 1-7: Navigate to pages
 * - ⌘/Ctrl + K: Open search (handled by search-dialog.tsx)
 * - Escape: Go back
 */
export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape in inputs
        if (e.key !== "Escape") return;
      }

      // ⌘/Ctrl + 1-7: Navigate to pages
      if (meta && e.key >= "1" && e.key <= "7") {
        const index = parseInt(e.key, 10) - 1;
        if (index < NAV_ROUTES.length) {
          e.preventDefault();
          router.push(NAV_ROUTES[index]);
        }
        return;
      }

      // Escape: Go back (only when not in a dialog/modal)
      if (e.key === "Escape" && !meta) {
        // Don't interfere with dialogs/modals
        const openDialog = document.querySelector("[role='dialog']");
        if (openDialog) return;

        e.preventDefault();
        router.back();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);
}
