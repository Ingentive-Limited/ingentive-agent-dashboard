import fs from "fs";
import path from "path";
import type { TokenUsage, CostEstimate } from "./types";

export function emptyTokenUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens:
      a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a Date as `YYYY-MM-DD` using LOCAL date components.
 *
 * `Date#toISOString().slice(0, 10)` looks tempting but is wrong: across a DST
 * spring-forward boundary, calling `setDate(getDate() + 1)` on a midnight-
 * local date advances local time by one day yet only advances UTC time by
 * 23 hours, so two consecutive cursor iterations can produce the SAME ISO
 * date string. That manifested as a duplicate React key on the activity
 * heatmap ("Encountered two children with the same key, 2026-03-29") and as
 * a missing day in token aggregations. Using local components avoids the
 * issue entirely.
 */
export function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Check whether `filePath` is contained within `baseDir`, defending against
 * both lexical traversal (`../`) and symlink escapes.
 *
 * Behavior:
 * - Fails (returns false) if the lexical resolved path is outside baseDir.
 * - Fails (returns false) if symlink resolution shows the path escapes baseDir.
 * - If the file does not exist yet (ENOENT), the lexical check is authoritative
 *   and this returns true. Callers should not rely on this function for a
 *   non-existent file unless they are about to create it inside baseDir.
 * - Fails (returns false) on any other realpath error — fail-closed so that
 *   transient filesystem errors do not silently allow containment bypass.
 */
export function isWithinDir(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  const resolvedBaseWithSep = resolvedBase + path.sep;
  if (!(resolved.startsWith(resolvedBaseWithSep) || resolved === resolvedBase)) {
    return false;
  }

  // Resolve the base's real path once; if the base itself can't be resolved,
  // we can't safely make any containment decision.
  let realBase: string;
  try {
    realBase = fs.realpathSync(resolvedBase);
  } catch {
    return false;
  }
  const realBaseWithSep = realBase + path.sep;

  try {
    const realPath = fs.realpathSync(resolved);
    return realPath.startsWith(realBaseWithSep) || realPath === realBase;
  } catch (err) {
    // If the file doesn't exist yet, the lexical check (already passed above)
    // is the best we can do. For any other error, fail closed.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return true;
    }
    return false;
  }
}

const READ_CHUNK_SIZE = 8192;

/**
 * Result of an incremental tail-read of a JSONL file.
 *
 * - `newLines`: lines that have been appended since the cached offset. Empty
 *   when the file is unchanged. The final partial line (no trailing `\n`) is
 *   dropped so callers never see a half-written record; the next poll will
 *   pick it up once the writer flushes the newline.
 * - `fullReparse`: true when incremental read is impossible (first read,
 *   file shrank, or mtime changed with the same size — all of which suggest
 *   rotation or rewrite). Callers should fall back to a full scan.
 * - `currentSize` / `currentMtimeMs`: fresh stat values to store on the
 *   cache after the caller folds `newLines` (or a full reparse) into the
 *   accumulated value.
 */
export interface IncrementalReadResult {
  newLines: string[];
  fullReparse: boolean;
  currentSize: number;
  currentMtimeMs: number;
}

/**
 * Read only the bytes appended to a JSONL file since the last cache hit.
 *
 * Why: tokensFromAudit and the three claude-data caches all key on
 * `{mtimeMs, size}` and fall back to a full `readLastLines` re-parse on any
 * mismatch. For multi-MB audit files this is the dominant cost of dashboard
 * polling. Since JSONL is append-only in the steady state, we can read just
 * the new tail and accumulate into the cached value.
 *
 * Returns `fullReparse: true` when the caller can't safely use the
 * incremental path — first read (cachedSize === 0), file shrank (rotation),
 * or unchanged-size-with-different-mtime (likely a rewrite).
 */
export async function readIncrementalLines(
  filePath: string,
  cachedSize: number,
  cachedMtimeMs: number
): Promise<IncrementalReadResult> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return {
      newLines: [],
      fullReparse: false,
      currentSize: cachedSize,
      currentMtimeMs: cachedMtimeMs,
    };
  }

  const currentSize = stat.size;
  const currentMtimeMs = stat.mtimeMs;

  // Unchanged → short-circuit. Caller returns its cached value.
  if (currentSize === cachedSize && currentMtimeMs === cachedMtimeMs) {
    return { newLines: [], fullReparse: false, currentSize, currentMtimeMs };
  }

  // First-ever read, file shrank, or rewrite-in-place → must re-scan.
  if (cachedSize === 0 || currentSize < cachedSize) {
    return { newLines: [], fullReparse: true, currentSize, currentMtimeMs };
  }

  // Same size, different mtime → file was rewritten with identical length.
  // Rare, but treat as a full re-scan to be safe.
  if (currentSize === cachedSize) {
    return { newLines: [], fullReparse: true, currentSize, currentMtimeMs };
  }

  // currentSize > cachedSize: read the new tail.
  const bytesToRead = currentSize - cachedSize;
  const fd = await fs.promises.open(filePath, "r");
  let chunk: string;
  try {
    const buf = Buffer.alloc(bytesToRead);
    await fd.read(buf, 0, bytesToRead, cachedSize);
    chunk = buf.toString("utf-8");
  } catch {
    return { newLines: [], fullReparse: true, currentSize, currentMtimeMs };
  } finally {
    await fd.close();
  }

  // Split on `\n`. The last element is either an empty string (file ends in
  // `\n` — clean split) or a partial line caught mid-write. Drop it either
  // way; we'll see the rest on the next poll once the writer flushes.
  const parts = chunk.split("\n");
  parts.pop();
  const newLines = parts.filter((l) => l.length > 0);

  return { newLines, fullReparse: false, currentSize, currentMtimeMs };
}

export async function readLastLines(
  filePath: string,
  n: number
): Promise<string[]> {
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) return [];

  if (fileSize < 65536) {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-n);
  }

  const fd = await fs.promises.open(filePath, "r");
  try {
    const lines: string[] = [];
    let remaining = "";
    let position = fileSize;

    while (lines.length < n && position > 0) {
      const chunkSize = Math.min(READ_CHUNK_SIZE, position);
      position -= chunkSize;
      const buf = Buffer.alloc(chunkSize);
      await fd.read(buf, 0, chunkSize, position);
      const chunk = buf.toString("utf-8") + remaining;
      const parts = chunk.split("\n");
      remaining = parts[0];
      for (let i = parts.length - 1; i >= 1; i--) {
        const line = parts[i].trim();
        if (line) lines.push(line);
        if (lines.length >= n) break;
      }
    }

    if (position === 0 && remaining.trim() && lines.length < n) {
      lines.push(remaining.trim());
    }

    return lines.reverse();
  } finally {
    await fd.close();
  }
}

export function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  const time = `~${hour}:${min.padStart(2, "0")}`;
  const days: Record<string, string> = {
    "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
    "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday",
  };
  if (dow === "*") return `Every day at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  if (days[dow]) return `Every ${days[dow]} at ${time}`;
  return `Cron: ${cron}`;
}

export function projectNameFromPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export interface PricingConfig {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning?: number;
}

export function calculateCost(tokens: TokenUsage, pricing: PricingConfig): CostEstimate {
  const inputCost = tokens.input_tokens * pricing.input;
  const outputCost = tokens.output_tokens * pricing.output;
  const cacheWriteCost = tokens.cache_creation_input_tokens * pricing.cacheWrite;
  const cacheReadCost = tokens.cache_read_input_tokens * pricing.cacheRead;
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
  };
}
