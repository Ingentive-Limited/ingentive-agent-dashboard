"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderOpen, MessageSquare } from "lucide-react";
import type { SearchResult } from "@/lib/types";

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus trap within dialog
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const focusableEls = dialog.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableEls.length === 0) return;

    const first = focusableEls[0];
    const last = focusableEls[focusableEls.length - 1];

    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    dialog.addEventListener("keydown", trapFocus);
    inputRef.current?.focus();
    return () => dialog.removeEventListener("keydown", trapFocus);
  }, [open, results]);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const navigate = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const typeIcon = (type: SearchResult["type"]) => {
    switch (type) {
      case "project": return <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />;
      case "session": return <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />;
      case "conversation": return <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />;
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Search sessions, projects, and conversations. Press Command K."
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md border border-transparent hover:border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground" aria-hidden="true">
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </button>
    );
  }

  const resultCount = results.length;
  const statusText = loading
    ? "Searching..."
    : query.length >= 2
      ? `${resultCount} result${resultCount !== 1 ? "s" : ""} found`
      : "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-lg rounded-lg border bg-background shadow-lg"
      >
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, projects, conversations..."
            aria-label="Search sessions, projects, and conversations"
            aria-autocomplete="list"
            aria-controls="search-results"
            className="flex-1 bg-transparent py-3 px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && (
            <div role="status" aria-label="Searching">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              <span className="sr-only">Searching...</span>
            </div>
          )}
        </div>

        <div id="search-results" aria-live="polite">
          <span className="sr-only">{statusText}</span>

          {results.length > 0 && (
            <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Search results">
              {results.map((result, i) => (
                <button
                  key={`${result.type}-${i}`}
                  role="option"
                  aria-selected={false}
                  onClick={() => navigate(result.href)}
                  className="flex items-start gap-3 w-full rounded-md px-3 py-2 text-left hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {typeIcon(result.type)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{result.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
                    {result.snippet && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 font-mono">
                        {result.snippet}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 capitalize" aria-hidden="true">
                    {result.type}
                  </span>
                </button>
              ))}
            </div>
          )}

          {query.length >= 2 && !loading && results.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No results found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
