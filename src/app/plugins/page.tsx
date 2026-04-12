"use client";

import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Puzzle, Package, Globe, User, Copy, Check } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { InstalledPlugin } from "@/lib/types";
import { useState } from "react";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
      aria-label={`Copy command: ${command}`}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
    </button>
  );
}

function PluginCard({ plugin }: { plugin: InstalledPlugin }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Puzzle className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <CardTitle className="text-base truncate">{plugin.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className="text-xs gap-1">
              {plugin.scope === "user" ? (
                <User className="h-2.5 w-2.5" aria-hidden="true" />
              ) : (
                <Package className="h-2.5 w-2.5" aria-hidden="true" />
              )}
              {plugin.scope}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" aria-hidden="true" />
              v{plugin.version}
            </span>
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" aria-hidden="true" />
              {plugin.marketplace}
            </span>
          </div>
          {plugin.installedAt && (
            <p className="text-[11px] text-muted-foreground">
              Installed {formatRelativeTime(plugin.installedAt)}
              {plugin.lastUpdated && plugin.lastUpdated !== plugin.installedAt && (
                <> &middot; Updated {formatRelativeTime(plugin.lastUpdated)}</>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PluginsPage() {
  const { data: plugins, isLoading } = usePolling<InstalledPlugin[]>(
    "/api/plugins",
    30000
  );

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading plugins">
        <h1 className="text-2xl font-bold">Plugins & MCP Servers</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
        <span className="sr-only">Loading plugins...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plugins & MCP Servers</h1>
        <span className="text-sm text-muted-foreground">
          {plugins?.length || 0} installed
        </span>
      </div>

      {!plugins || plugins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Puzzle className="h-12 w-12 text-muted-foreground/30 mb-4" aria-hidden="true" />
            <p className="text-muted-foreground font-medium">No plugins installed</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Plugins extend Claude Code with new tools and capabilities.
              Install your first plugin to see it here.
            </p>
            <div className="mt-4 rounded-lg bg-muted/50 border px-4 py-3 font-mono text-sm flex items-center gap-2">
              <code>claude plugin install &lt;plugin-name&gt;</code>
              <CopyCommand command="claude plugin install" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard key={`${plugin.name}@${plugin.marketplace}`} plugin={plugin} />
          ))}
        </div>
      )}
    </div>
  );
}
