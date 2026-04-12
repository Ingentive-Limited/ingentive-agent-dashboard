"use client";

import { useState, useMemo } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatTokens, formatCost } from "@/lib/utils";
import type { ProjectStats } from "@/lib/types";
import Link from "next/link";
import {
  FolderOpen,
  FileText,
  BarChart3,
  ArrowUpDown,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  GitCompare,
  X,
  Star,
} from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { EmptyState } from "@/components/empty-state";

type SortKey = "name" | "activity" | "tokens" | "cost" | "sessions" | "errors";
type GroupMode = "none" | "directory";

function ErrorRateBadge({ errorRate, errorCount, successCount }: { errorRate: number; errorCount: number; successCount: number }) {
  if (errorCount + successCount === 0) return null;
  const pct = Math.round(errorRate * 100);
  const variant = pct >= 30 ? "destructive" : pct >= 10 ? "secondary" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] gap-1">
      {pct > 0 ? (
        <AlertCircle className="h-2.5 w-2.5" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
      )}
      {pct}% errors
    </Badge>
  );
}

function ProjectCard({
  project,
  showCost,
  selected,
  onSelect,
  compareMode,
  isFavorite,
  onToggleFavorite,
}: {
  project: ProjectStats;
  showCost: boolean;
  selected: boolean;
  onSelect: () => void;
  compareMode: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const totalTokens = project.totalTokens.input_tokens + project.totalTokens.output_tokens;

  const cardInner = (
    <Card className={`hover:bg-muted/50 transition-colors cursor-pointer h-full ${selected ? "ring-2 ring-primary" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFavorite();
                }
              }}
              className="shrink-0 hover:scale-110 transition-transform"
              aria-label={isFavorite ? `Unpin ${project.name}` : `Pin ${project.name}`}
              title={isFavorite ? "Unpin project" : "Pin project"}
            >
              <Star
                className={`h-4 w-4 ${
                  isFavorite
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/30 hover:text-amber-400/60"
                }`}
                aria-hidden="true"
              />
            </span>
            <CardTitle className="text-base truncate">{project.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ErrorRateBadge
              errorRate={project.errorRate}
              errorCount={project.errorCount}
              successCount={project.successCount}
            />
            <Badge variant="secondary" className="text-xs">
              {project.sessionCount} sessions
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {project.lastActivity
                ? formatRelativeTime(project.lastActivity)
                : "No activity"}
            </span>
            <span className="flex items-center gap-1">
              <BarChart3 className="h-3 w-3" aria-hidden="true" />
              {formatTokens(totalTokens)} tokens
            </span>
            {showCost && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" aria-hidden="true" />
                {formatCost(project.cost.totalCost)}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (compareMode) {
    return (
      <button type="button" className="text-left w-full" onClick={onSelect}>
        {cardInner}
      </button>
    );
  }

  return (
    <Link href={`/projects/${encodeURIComponent(project.id)}`}>
      {cardInner}
    </Link>
  );
}

function ComparisonPanel({
  projects,
  showCost,
  onClose,
}: {
  projects: ProjectStats[];
  showCost: boolean;
  onClose: () => void;
}) {
  const maxTokens = Math.max(
    ...projects.map((p) => p.totalTokens.input_tokens + p.totalTokens.output_tokens),
    1
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Project Comparison</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close comparison">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Project comparison">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Metric</th>
                {projects.map((p) => (
                  <th key={p.id} className="pb-2 px-4 font-medium">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Sessions</td>
                {projects.map((p) => (
                  <td key={p.id} className="py-2 px-4 font-mono">{p.sessionCount}</td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Total Tokens</td>
                {projects.map((p) => {
                  const total = p.totalTokens.input_tokens + p.totalTokens.output_tokens;
                  const pct = (total / maxTokens) * 100;
                  return (
                    <td key={p.id} className="py-2 px-4">
                      <div className="space-y-1">
                        <span className="font-mono">{formatTokens(total)}</span>
                        <div
                          className="w-full h-1.5 bg-muted rounded-full overflow-hidden"
                          role="meter"
                          aria-valuenow={total}
                          aria-valuemin={0}
                          aria-valuemax={maxTokens}
                          aria-label={`Token usage: ${formatTokens(total)}`}
                        >
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Input</td>
                {projects.map((p) => (
                  <td key={p.id} className="py-2 px-4 font-mono">
                    {formatTokens(p.totalTokens.input_tokens)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Output</td>
                {projects.map((p) => (
                  <td key={p.id} className="py-2 px-4 font-mono">
                    {formatTokens(p.totalTokens.output_tokens)}
                  </td>
                ))}
              </tr>
              {showCost && (
                <tr>
                  <td className="py-2 pr-4 text-muted-foreground">Cost</td>
                  {projects.map((p) => (
                    <td key={p.id} className="py-2 px-4 font-mono">
                      {formatCost(p.cost.totalCost)}
                    </td>
                  ))}
                </tr>
              )}
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Error Rate</td>
                {projects.map((p) => (
                  <td key={p.id} className="py-2 px-4">
                    <ErrorRateBadge
                      errorRate={p.errorRate}
                      errorCount={p.errorCount}
                      successCount={p.successCount}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Last Activity</td>
                {projects.map((p) => (
                  <td key={p.id} className="py-2 px-4 text-muted-foreground">
                    {p.lastActivity ? formatRelativeTime(p.lastActivity) : "-"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading } = usePolling<ProjectStats[]>(
    "/api/projects/stats",
    10000
  );
  const [sortKey, setSortKey] = usePersistedState<SortKey>("projects-sort", "activity");
  const [groupMode, setGroupMode] = usePersistedState<GroupMode>("projects-group", "none");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { isApi } = useBillingMode();
  const { favoriteIds, isFavorite, toggleFavorite } = useFavorites();

  const sorted = useMemo(() => {
    if (!projects) return [];
    const copy = [...projects];
    copy.sort((a, b) => {
      // Pinned projects always come first
      const aFav = favoriteIds.includes(a.id) ? 1 : 0;
      const bFav = favoriteIds.includes(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;

      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "activity":
          return (b.lastActivity || "").localeCompare(a.lastActivity || "");
        case "tokens":
          return (
            b.totalTokens.input_tokens +
            b.totalTokens.output_tokens -
            (a.totalTokens.input_tokens + a.totalTokens.output_tokens)
          );
        case "cost":
          return b.cost.totalCost - a.cost.totalCost;
        case "sessions":
          return b.sessionCount - a.sessionCount;
        case "errors":
          return b.errorRate - a.errorRate;
        default:
          return 0;
      }
    });
    return copy;
  }, [projects, sortKey, favoriteIds]);

  const grouped = useMemo(() => {
    if (groupMode === "none") return null;
    const groups: Record<string, ProjectStats[]> = {};
    for (const p of sorted) {
      // ProjectStats doesn't have path directly, derive from name
      const key = "Projects";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [sorted, groupMode]);

  const selectedProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => selectedIds.has(p.id));
  }, [projects, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
  };

  if (isLoading || !projects) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading projects">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <span className="sr-only">Loading projects...</span>
      </div>
    );
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "activity", label: "Recent" },
    { key: "name", label: "Name" },
    { key: "tokens", label: "Tokens" },
    ...(isApi ? [{ key: "cost" as SortKey, label: "Cost" }] : []),
    { key: "sessions", label: "Sessions" },
    { key: "errors", label: "Errors" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <span className="text-sm text-muted-foreground">
          {projects.length} projects
        </span>
      </div>

      {projects.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Sort by">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {sortOptions.map((opt) => (
              <Button
                key={opt.key}
                variant={sortKey === opt.key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSortKey(opt.key)}
                role="radio"
                aria-checked={sortKey === opt.key}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            variant={groupMode === "directory" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() =>
              setGroupMode((m) => (m === "none" ? "directory" : "none"))
            }
            aria-pressed={groupMode === "directory"}
          >
            <FolderOpen className="h-3 w-3" aria-hidden="true" />
            Group by directory
          </Button>
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            variant={compareMode ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => {
              setCompareMode(!compareMode);
              if (compareMode) setSelectedIds(new Set());
            }}
            aria-pressed={compareMode}
          >
            <GitCompare className="h-3 w-3" aria-hidden="true" />
            Compare
            {compareMode && selectedIds.size > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-1 h-4 px-1">
                {selectedIds.size}
              </Badge>
            )}
          </Button>
        </div>
      )}

      {compareMode && selectedProjects.length >= 2 && (
        <ComparisonPanel
          projects={selectedProjects}
          showCost={isApi}
          onClose={() => {
            setCompareMode(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      {compareMode && selectedIds.size < 2 && (
        <Card className="border-dashed">
          <CardContent className="py-3">
            <p className="text-sm text-muted-foreground text-center">
              Select 2-4 projects to compare
            </p>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects found"
          description="Start a Claude session in any project directory to see it here. Each directory where you use Claude becomes a tracked project."
          command="cd your-project && claude"
        />
      ) : grouped ? (
        <div className="space-y-6">
          {grouped.map(([dir, dirProjects]) => (
            <div key={dir}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 font-mono">
                {dir}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dirProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    showCost={isApi}
                    selected={selectedIds.has(project.id)}
                    onSelect={() => toggleSelect(project.id)}
                    compareMode={compareMode}
                    isFavorite={isFavorite(project.id)}
                    onToggleFavorite={() => toggleFavorite(project.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              showCost={isApi}
              selected={selectedIds.has(project.id)}
              onSelect={() => toggleSelect(project.id)}
              compareMode={compareMode}
              isFavorite={isFavorite(project.id)}
              onToggleFavorite={() => toggleFavorite(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
