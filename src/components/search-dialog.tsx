"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderOpen, MessageSquare } from "lucide-react";
import type { SearchResult } from "@/lib/types";

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      case "project": return <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "session": return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
      case "conversation": return <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md border border-transparent hover:border-border"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg rounded-lg border bg-background shadow-lg">
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, projects, conversations..."
            className="flex-1 bg-transparent py-3 px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          )}
        </div>

        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto p-2">
            {results.map((result, i) => (
              <button
                key={`${result.type}-${i}`}
                onClick={() => navigate(result.href)}
                className="flex items-start gap-3 w-full rounded-md px-3 py-2 text-left hover:bg-muted transition-colors"
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
                <span className="text-[10px] text-muted-foreground shrink-0 capitalize">
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
  );
}
