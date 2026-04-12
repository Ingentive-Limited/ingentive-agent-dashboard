"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Check } from "lucide-react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted-foreground/10 transition-colors text-muted-foreground hover:text-foreground"
      aria-label={copied ? "Copied" : `Copy command: ${text}`}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  command?: string;
}

export function EmptyState({ icon: Icon, title, description, command }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Icon className="h-12 w-12 text-muted-foreground/30 mb-4" aria-hidden="true" />
        <p className="text-muted-foreground font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-md">{description}</p>
        {command && (
          <div className="mt-4 rounded-lg bg-muted/50 border px-4 py-2.5 font-mono text-sm flex items-center gap-2">
            <code>{command}</code>
            <CopyButton text={command} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
