"use client";

import { ThemeProvider } from "@/hooks/use-theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProviderProvider } from "@/hooks/use-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ProviderProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ProviderProvider>
    </ThemeProvider>
  );
}
