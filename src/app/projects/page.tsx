"use client";

import { useState, useMemo } from "react";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatTokens, formatCost } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/types";
import Link from "next/link";
import { FolderOpen, FileText, BarChart3, ArrowUpDown, DollarSign } from "lucide-react";

type SortKey = "name" | "activity" | "tokens" | "cost" | "sessions";
type GroupMode = "none" | "directory";

function parentDir(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return parts.slice(0, -1).join("/");
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const totalTokens = project.totalTokens.input_tokens + project.totalTokens.output_tokens;
  return (
    <Link href={`/projects/${encodeURIComponent(project.id)}`}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base truncate">{project.name}</CardTitle>
            <Badge variant="secondary" className="text-xs shrink-0">
              {project.sessionCount} sessions
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-mono truncate">
              {project.path}
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {project.lastActivity
                  ? formatRelativeTime(project.lastActivity)
                  : "No activity"}
              </span>
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                {formatTokens(totalTokens)} tokens
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {formatCost(project.cost.totalCost)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading } = usePolling<ProjectSummary[]>(
    "/api/projects",
    10000
  );
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [groupMode, setGroupMode] = useState<GroupMode>("none");

  const sorted = useMemo(() => {
    if (!projects) return [];
    const copy = [...projects];
    copy.sort((a, b) => {
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
        default:
          return 0;
      }
    });
    return copy;
  }, [projects, sortKey]);

  const grouped = useMemo(() => {
    if (groupMode === "none") return null;
    const groups: Record<string, ProjectSummary[]> = {};
    for (const p of sorted) {
      const key = parentDir(p.path);
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [sorted, groupMode]);

  if (isLoading || !projects) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "activity", label: "Recent" },
    { key: "name", label: "Name" },
    { key: "tokens", label: "Tokens" },
    { key: "cost", label: "Cost" },
    { key: "sessions", label: "Sessions" },
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
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            {sortOptions.map((opt) => (
              <Button
                key={opt.key}
                variant={sortKey === opt.key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSortKey(opt.key)}
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
          >
            <FolderOpen className="h-3 w-3" />
            Group by directory
          </Button>
        </div>
      )}

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No projects found</p>
          </CardContent>
        </Card>
      ) : grouped ? (
        <div className="space-y-6">
          {grouped.map(([dir, dirProjects]) => (
            <div key={dir}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 font-mono">
                {dir}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dirProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
