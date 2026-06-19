"use client";

import { useEffect, useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { useProvider } from "@/hooks/use-provider";
import type { SystemStatus, ProviderStatus } from "@/lib/types";
import { Terminal, Activity, Key, CreditCard, ChevronDown } from "lucide-react";

type DotStatus = "operational" | "degraded" | "unknown";

function StatusDot({ status, size = "sm" }: { status: DotStatus; size?: "sm" | "xs" }) {
  const color =
    status === "operational"
      ? "bg-green-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";
  const dim = size === "xs" ? "h-1 w-1" : "h-1.5 w-1.5";
  return <span className={`inline-block ${dim} rounded-full ${color}`} aria-hidden="true" />;
}

function rollupStatus(data: SystemStatus, provider: string): DotStatus {
  const relevant: ProviderStatus[] = [];
  if (data.claude && (provider === "all" || provider === "claude")) relevant.push(data.claude);
  if (data.codex && (provider === "all" || provider === "codex")) relevant.push(data.codex);
  if (data.scout && (provider === "all" || provider === "scout")) relevant.push(data.scout);
  if (data.copilot && (provider === "all" || provider === "copilot")) relevant.push(data.copilot);
  if (relevant.length === 0) return "unknown";
  if (relevant.some((r) => r.apiStatus === "degraded")) return "degraded";
  if (relevant.every((r) => r.apiStatus === "operational")) return "operational";
  return "unknown";
}

function statusLabel(s: DotStatus): string {
  if (s === "operational") return "All systems operational";
  if (s === "degraded") return "Some providers degraded";
  return "Provider status unknown";
}

function ProviderDetailRow({ name, status }: { name: string; status: ProviderStatus }) {
  const apiText =
    status.apiStatus === "operational"
      ? "OK"
      : status.apiStatus === "degraded"
        ? "Degraded"
        : "—";
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={status.apiStatus} size="xs" />
        <span className="truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-muted-foreground/70">
        {status.cliVersion !== "unknown" && (
          <span className="flex items-center gap-1" title={`${name} CLI ${status.cliVersion}`}>
            <Terminal className="h-2.5 w-2.5" aria-hidden="true" />
            <span className="truncate max-w-[80px]">{status.cliVersion}</span>
          </span>
        )}
        <span>{apiText}</span>
      </div>
    </div>
  );
}

const STORAGE_KEY = "ingentive:status-expanded";

export function SystemStatusBar() {
  const { provider } = useProvider();
  const { data } = usePolling<SystemStatus>(`/api/status?provider=${provider}`, 30000);
  const { isApi } = useBillingMode();

  // Collapsed by default; persist user's choice across reloads.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setExpanded(true);
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
  }, [expanded]);

  if (!data) return null;

  const overall = rollupStatus(data, provider);

  return (
    <div className="text-[11px] text-muted-foreground" aria-label="System status">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-sm py-1 px-1 -mx-1 hover:bg-accent/40 transition-colors"
        aria-expanded={expanded}
        aria-label={`System status: ${statusLabel(overall)}. ${expanded ? "Hide" : "Show"} details.`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={overall} />
          <Activity className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{data.activeSessions} active</span>
          <span className="opacity-30" aria-hidden="true">·</span>
          {isApi ? (
            <Key className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <CreditCard className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{isApi ? "API" : "Subscription"}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-50 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="mt-1 space-y-0 border-t pt-1.5">
          {data.claude && (provider === "all" || provider === "claude") && (
            <ProviderDetailRow name="Claude" status={data.claude} />
          )}
          {data.codex && (provider === "all" || provider === "codex") && (
            <ProviderDetailRow name="Codex" status={data.codex} />
          )}
          {data.scout && (provider === "all" || provider === "scout") && (
            <ProviderDetailRow name="Scout" status={data.scout} />
          )}
          {data.copilot && (provider === "all" || provider === "copilot") && (
            <ProviderDetailRow name="Copilot" status={data.copilot} />
          )}
        </div>
      )}
    </div>
  );
}
