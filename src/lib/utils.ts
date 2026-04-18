import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert a session entrypoint identifier into a user-facing label.
 *
 * Claude entrypoints:
 *   - "claude-desktop" → "Desktop"
 *   - anything else    → "CLI"
 *
 * Codex entrypoints (from the `source` column in ~/.codex/state_5.sqlite):
 *   - "vscode"                       → "VSCode"
 *   - "codex_desktop" / "desktop"    → "Desktop"
 *   - "cli" / "" / undefined         → "CLI"
 *   - anything else                  → the raw value, title-cased
 */
export function formatEntrypoint(entrypoint: string | undefined | null): string {
  if (!entrypoint) return "CLI";
  const normalized = entrypoint.toLowerCase();
  if (normalized === "claude-desktop") return "Desktop";
  if (normalized === "vscode" || normalized === "vs-code") return "VSCode";
  if (normalized === "codex_desktop" || normalized === "desktop") return "Desktop";
  if (normalized === "cli") return "CLI";
  // Fallback: return the raw value with first letter capitalized so unknown
  // sources still render something readable.
  return entrypoint.charAt(0).toUpperCase() + entrypoint.slice(1);
}

export function formatDuration(startMs: number): string {
  const diff = Date.now() - startMs;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  if (cost >= 0.001) return `$${cost.toFixed(4)}`;
  if (cost === 0) return "$0.00";
  return `<$0.001`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
