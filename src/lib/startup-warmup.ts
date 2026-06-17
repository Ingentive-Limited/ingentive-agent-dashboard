/**
 * Background cache warm-up.
 *
 * Heavy users have hundreds of MB of agent transcript data spread across
 * Claude Code JSONL files, Codex SQLite + rollouts, and Cowork audit
 * transcripts. The data layer caches each file's parsed token totals
 * keyed by mtime+size, so the SECOND read is near-free — but the first
 * page load still pays the cold scan (~60 seconds in extreme cases).
 *
 * This module fires off the same expensive scans in the background at
 * server boot so the cache is warm before the user's first request
 * lands. It runs as a fire-and-forget side-effect that all the data
 * modules trigger via a single import:
 *
 *   import "@/lib/startup-warmup"; // in any API route
 *
 * The warm-up touches the same functions a real request would call, so
 * it benefits from every existing per-file cache without duplicating
 * the work.
 *
 * Skipped under test / CI / build so we don't slow those down.
 */

import * as claude from "./claude-data";
import * as codex from "./codex-data";
import * as cowork from "./cowork-data";
import * as scout from "./scout-data";
import * as copilot from "./copilot-data";

let warmupStarted = false;

function shouldRun(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.VITEST) return false;
  if (process.env.CI) return false;
  // next build also imports this module; the warm-up would block the build.
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  return true;
}

export function startBackgroundWarmup(): void {
  if (warmupStarted || !shouldRun()) return;
  warmupStarted = true;

  // setImmediate so we don't block whatever called us (usually a route
  // file's side-effect import).
  setImmediate(() => {
    const start = Date.now();
    Promise.allSettled([
      // Claude — the slowest-to-cold endpoints all share the timeline,
      // history, and daily-tokens per-file caches. Hitting any one of
      // them warms the underlying caches the others depend on.
      claude.getDailyTokenUsage(140),
      claude.getOverview(),
      claude.getSessionHistory(),
      // Codex — overview pulls in active sessions + token totals.
      codex.getOverview(),
      codex.getSessionHistory(),
      // Cowork — discoverManifests + tokensFromAudit per file.
      cowork.getOverview(),
      cowork.getDailyTokenUsage(140),
      // Scout — discoverSessions + tokensFromEvents per file.
      scout.getDailyTokenUsage(140),
      scout.getOverview(),
      scout.getSessionHistory(),
      // Copilot — discoverSessions + tokensFromCopilotEvents per file.
      copilot.getDailyTokenUsage(140),
      copilot.getOverview(),
      copilot.getSessionHistory(),
    ])
      .then((results) => {
        const ms = Date.now() - start;
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          console.warn(
            `[warmup] completed in ${ms}ms with ${failed} provider(s) erroring (caches partially populated)`
          );
        } else {
          console.log(`[warmup] cache populated in ${ms}ms`);
        }
      })
      .catch(() => {
        // best-effort
      });
  });
}

// Kick off as a module-load side-effect so a single import is enough.
startBackgroundWarmup();
