"use client";

import { useState } from "react";
import { useTokenBudget, type BudgetStatus } from "@/hooks/use-token-budget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatTokens } from "@/lib/utils";
import { Settings2, AlertTriangle, TrendingUp, X, Bell } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TokenUsage } from "@/lib/types";

function formatLimit(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function parseLimit(value: string): number {
  const cleaned = value.trim().toUpperCase();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  if (cleaned.endsWith("M")) return num * 1_000_000;
  if (cleaned.endsWith("K")) return num * 1_000;
  return num;
}

function ProgressBar({
  label,
  percent,
  alert,
  exceeded,
}: {
  label: string;
  percent: number;
  alert: boolean;
  exceeded: boolean;
}) {
  const clamped = Math.min(percent, 100);
  const color = exceeded
    ? "bg-destructive"
    : alert
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      />
    </div>
  );
}

export function TokenBudgetAlert({ status }: { status: BudgetStatus }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!status.dailyAlert && !status.monthlyAlert) return null;

  const messages: string[] = [];
  if (status.dailyExceeded) {
    messages.push(
      `Daily token budget exceeded (${formatTokens(status.dailyUsed)} used)`
    );
  } else if (status.dailyAlert) {
    messages.push(
      `Approaching daily token limit (${Math.round(status.dailyPercent)}%)`
    );
  }
  if (status.monthlyExceeded) {
    messages.push(
      `Monthly token budget exceeded (${formatTokens(status.monthlyUsed)} used)`
    );
  } else if (status.monthlyAlert) {
    messages.push(
      `Approaching monthly token limit (${Math.round(status.monthlyPercent)}%)`
    );
  }

  const isExceeded = status.dailyExceeded || status.monthlyExceeded;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 ${
        isExceeded
          ? "border-destructive/50 bg-destructive/5"
          : "border-amber-500/50 bg-amber-500/5"
      }`}
      role="alert"
    >
      <AlertTriangle
        className={`h-4 w-4 shrink-0 ${
          isExceeded ? "text-destructive" : "text-amber-500"
        }`}
        aria-hidden="true"
      />
      <div className="flex-1 text-sm">
        {messages.map((msg, i) => (
          <p key={i}>{msg}</p>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss alert"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function TokenBudgetCard({
  dailyTokens,
  monthlyTokens,
}: {
  dailyTokens: TokenUsage;
  monthlyTokens: TokenUsage;
}) {
  const { budget, update, checkBudget } = useTokenBudget();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailyInput, setDailyInput] = useState(formatLimit(budget.dailyLimit));
  const [monthlyInput, setMonthlyInput] = useState(formatLimit(budget.monthlyLimit));
  const [thresholdInput, setThresholdInput] = useState(String(budget.alertThreshold));

  const dailyUsed =
    dailyTokens.input_tokens +
    dailyTokens.output_tokens +
    dailyTokens.cache_creation_input_tokens +
    dailyTokens.cache_read_input_tokens;

  const monthlyUsed =
    monthlyTokens.input_tokens +
    monthlyTokens.output_tokens +
    monthlyTokens.cache_creation_input_tokens +
    monthlyTokens.cache_read_input_tokens;

  const status = checkBudget(dailyUsed, monthlyUsed);

  return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-lg">Token Budget</CardTitle>
              {budget.enabled ? (
                <Badge variant="secondary" className="text-xs">Active</Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Inactive</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {budget.enabled && (status.dailyAlert || status.monthlyAlert) && (
                <Tooltip>
                  <TooltipTrigger>
                    <span
                      className={`flex items-center justify-center h-8 w-8 rounded-md ${
                        status.dailyExceeded || status.monthlyExceeded
                          ? "text-destructive"
                          : "text-amber-500"
                      }`}
                      role="status"
                      aria-label={
                        status.dailyExceeded || status.monthlyExceeded
                          ? "Token budget exceeded"
                          : "Approaching token budget limit"
                      }
                    >
                      <Bell className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {status.dailyExceeded && (
                      <p>Daily budget exceeded ({formatTokens(status.dailyUsed)} used)</p>
                    )}
                    {!status.dailyExceeded && status.dailyAlert && (
                      <p>Approaching daily limit ({Math.round(status.dailyPercent)}%)</p>
                    )}
                    {status.monthlyExceeded && (
                      <p>Monthly budget exceeded ({formatTokens(status.monthlyUsed)} used)</p>
                    )}
                    {!status.monthlyExceeded && status.monthlyAlert && (
                      <p>Approaching monthly limit ({Math.round(status.monthlyPercent)}%)</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setDailyInput(formatLimit(budget.dailyLimit));
                setMonthlyInput(formatLimit(budget.monthlyLimit));
                setThresholdInput(String(budget.alertThreshold));
                setSettingsOpen(!settingsOpen);
              }}
              aria-label="Budget settings"
              title="Budget settings"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {budget.enabled && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Daily</span>
                  <span>
                    {formatTokens(dailyUsed)}{" "}
                    <span className="text-muted-foreground">
                      / {formatLimit(budget.dailyLimit)}
                    </span>
                  </span>
                </div>
                <ProgressBar
                  label="Daily token budget usage"
                  percent={status.dailyPercent}
                  alert={status.dailyAlert}
                  exceeded={status.dailyExceeded}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Monthly</span>
                  <span>
                    {formatTokens(monthlyUsed)}{" "}
                    <span className="text-muted-foreground">
                      / {formatLimit(budget.monthlyLimit)}
                    </span>
                  </span>
                </div>
                <ProgressBar
                  label="Monthly token budget usage"
                  percent={status.monthlyPercent}
                  alert={status.monthlyAlert}
                  exceeded={status.monthlyExceeded}
                />
              </div>
            </>
          )}

          {!budget.enabled && !settingsOpen && (
            <p className="text-sm text-muted-foreground">
              Set daily and monthly token limits to track your usage and get alerts.
            </p>
          )}

          {settingsOpen && (
            <div className="space-y-4 rounded-lg border p-4" role="region" aria-label="Budget settings">
              <div className="flex items-center justify-between">
                <span id="budget-toggle-label" className="text-sm font-medium">Enable budget tracking</span>
                <Switch
                  checked={budget.enabled}
                  onCheckedChange={(checked) => update({ enabled: !!checked })}
                  aria-labelledby="budget-toggle-label"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="daily-limit">
                  Daily limit (e.g. 5M, 500K)
                </label>
                <Input
                  id="daily-limit"
                  value={dailyInput}
                  onChange={(e) => setDailyInput(e.target.value)}
                  onBlur={() => {
                    const parsed = parseLimit(dailyInput);
                    if (parsed > 0) {
                      update({ dailyLimit: parsed });
                      setDailyInput(formatLimit(parsed));
                    }
                  }}
                  className="h-8 text-sm"
                  placeholder="5M"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="monthly-limit">
                  Monthly limit (e.g. 100M, 50M)
                </label>
                <Input
                  id="monthly-limit"
                  value={monthlyInput}
                  onChange={(e) => setMonthlyInput(e.target.value)}
                  onBlur={() => {
                    const parsed = parseLimit(monthlyInput);
                    if (parsed > 0) {
                      update({ monthlyLimit: parsed });
                      setMonthlyInput(formatLimit(parsed));
                    }
                  }}
                  className="h-8 text-sm"
                  placeholder="100M"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="alert-threshold">
                  Alert at (%)
                </label>
                <Input
                  id="alert-threshold"
                  type="number"
                  min={1}
                  max={100}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  onBlur={() => {
                    const val = parseInt(thresholdInput, 10);
                    if (val >= 1 && val <= 100) {
                      update({ alertThreshold: val });
                    }
                  }}
                  className="h-8 text-sm"
                  placeholder="80"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setSettingsOpen(false)}
              >
                Done
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
  );
}
