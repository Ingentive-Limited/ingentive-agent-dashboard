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
