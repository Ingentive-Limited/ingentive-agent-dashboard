"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProviderProvider } from "@/hooks/use-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="theme"
    >
      <ProviderProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ProviderProvider>
    </ThemeProvider>
  );
}
