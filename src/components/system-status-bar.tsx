"use client";

import { usePolling } from "@/hooks/use-polling";
import { useBillingMode } from "@/hooks/use-billing-mode";
import type { SystemStatus } from "@/lib/types";
import { Terminal, Activity, Key, CreditCard } from "lucide-react";

function StatusDot({ status }: { status: "operational" | "degraded" | "unknown" }) {
  const color =
    status === "operational"
      ? "bg-green-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";

  const label =
    status === "operational"
      ? "API operational"
      : status === "degraded"
        ? "API degraded"
        : "API status unknown";

  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${color}`}
      aria-label={label}
      title={label}
    />
  );
}

export function SystemStatusBar() {
  const { data } = usePolling<SystemStatus>("/api/status", 30000);
  const { isApi } = useBillingMode();

  if (!data) return null;

  return (
    <div className="space-y-1.5 text-[11px] text-muted-foreground" aria-label="System status">
      <div className="flex items-center gap-1.5" title={`Claude CLI ${data.cliVersion}`}>
        <Terminal className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{data.cliVersion}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot status={data.apiStatus} />
        <span>
          {data.apiStatus === "operational"
            ? "API OK"
            : data.apiStatus === "degraded"
              ? "API Degraded"
              : "API Unknown"}
        </span>
      </div>
      <div className="flex items-center gap-1.5" title={`${data.activeSessions} active session${data.activeSessions !== 1 ? "s" : ""}`}>
        <Activity className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{data.activeSessions} active</span>
      </div>
      <div className="flex items-center gap-1.5" title={isApi ? "API billing mode" : "Subscription billing mode"}>
        {isApi ? (
          <Key className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <CreditCard className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span>{isApi ? "API" : "Subscription"}</span>
      </div>
    </div>
  );
}
