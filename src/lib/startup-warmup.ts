/**
 * Background cache warm-up.
 *
 * Heavy users have hundreds of MB of agent transcript data spread across
 * Claude Code JSONL files, Codex SQLite + rollouts, Cowork audit transcripts,
 * Scout sessions, and VS Code Copilot Chat sessions. The data layer caches
 * each file's parsed token totals keyed by mtime+size, so the second read
 * is near-free — but the first call still pays the cold scan.
 *
 * Design:
 * - Warm one critical call per provider (getOverview). It populates the
 *   per-file caches the other endpoints (history, daily-tokens) rely on,
 *   so we don't have to call each of them at startup.
 * - Concurrency 2: high enough to overlap I/O across providers, low enough
 *   not to OOM a 4 GB V8 heap during the parsing peak.
 * - Track progress so the Electron splash can show live status and only
 *   reveal the dashboard when warmup is complete.
 */

import * as claude from "./claude-data";
import * as codex from "./codex-data";
import * as cowork from "./cowork-data";
import * as scout from "./scout-data";
import * as copilot from "./copilot-data";

export type WarmupStatus = {
  complete: boolean;
  done: number;
  total: number;
  current: string | null;
  elapsedMs: number;
  failed: string[];
};

const status: WarmupStatus = {
  complete: false,
  done: 0,
  total: 0,
  current: null,
  elapsedMs: 0,
  failed: [],
};

let warmupStarted = false;
let warmupStart = 0;

export function getWarmupStatus(): WarmupStatus {
  return {
    ...status,
    elapsedMs: warmupStart ? Date.now() - warmupStart : 0,
  };
}

function shouldRun(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.VITEST) return false;
  if (process.env.CI) return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  return true;
}

type ProviderJob = { name: string; run: () => Promise<unknown> };

async function runWithConcurrency(jobs: ProviderJob[], limit: number): Promise<void> {
  let i = 0;
  const workers: Promise<void>[] = [];
  const worker = async (): Promise<void> => {
    while (i < jobs.length) {
      const job = jobs[i++];
      status.current = job.name;
      try {
        await job.run();
      } catch (err) {
        status.failed.push(job.name);
        console.warn(
          `[warmup] ${job.name} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      status.done += 1;
    }
  };
  for (let w = 0; w < Math.min(limit, jobs.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

export function startBackgroundWarmup(): void {
  if (warmupStarted || !shouldRun()) return;
  warmupStarted = true;
  warmupStart = Date.now();

  // getOverview() walks every transcript file for its provider, so it
  // pre-populates the per-file mtime+size caches that getDailyTokenUsage
  // and getSessionHistory rely on. One call per provider is enough.
  const jobs: ProviderJob[] = [
    { name: "claude", run: () => claude.getOverview() },
    { name: "codex", run: () => codex.getOverview() },
    { name: "cowork", run: () => cowork.getOverview() },
    { name: "scout", run: () => scout.getOverview() },
    { name: "copilot", run: () => copilot.getOverview() },
  ];
  status.total = jobs.length;

  setImmediate(async () => {
    // Concurrency 2: empirically the sweet spot. 1 = unnecessarily slow,
    // 5 = peaks > 3 GB on heavy Cowork fleets.
    await runWithConcurrency(jobs, 2);
    status.complete = true;
    status.current = null;
    const ms = Date.now() - warmupStart;
    if (status.failed.length > 0) {
      console.warn(
        `[warmup] completed in ${ms}ms with ${status.failed.length} provider(s) erroring (${status.failed.join(", ")})`,
      );
    } else {
      console.log(`[warmup] cache populated in ${ms}ms`);
    }
  });
}

startBackgroundWarmup();
