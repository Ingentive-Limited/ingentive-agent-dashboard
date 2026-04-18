"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  Bell,
  FolderOpen,
  BarChart3,
  Clock,
  History,
  Puzzle,
  Sparkles,
  Bot,
  Layers,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SystemStatusBar } from "@/components/system-status-bar";
import { useProvider, type ProviderFilter } from "@/hooks/use-provider";

/** Detect modifier key: ⌘ on Mac, Ctrl on Windows/Linux. */
function detectModifier(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "⌘" : "Ctrl+";
}

const monitorLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, shortcutKey: "1" },
  { href: "/sessions", label: "Sessions", icon: Terminal, shortcutKey: "2" },
  { href: "/awaiting", label: "Awaiting Input", icon: Bell, shortcutKey: "3" },
  { href: "/projects", label: "Projects", icon: FolderOpen, shortcutKey: "4" },
];

const analyticsLinks = [
  { href: "/tokens", label: "Token Usage", icon: BarChart3, shortcutKey: "5" },
  { href: "/history", label: "Session History", icon: History, shortcutKey: "6" },
];

const automationLinks = [
  { href: "/tasks", label: "Scheduled Tasks", icon: Clock, shortcutKey: "7" },
  { href: "/plugins", label: "Plugins", icon: Puzzle, shortcutKey: "8" },
];

function NavGroup({
  label,
  links,
  isActive,
  modifier,
}: {
  label: string;
  links: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; shortcutKey?: string }>;
  isActive: (href: string) => boolean;
  modifier: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {links.map((link) => (
            <SidebarMenuItem key={link.href}>
              <SidebarMenuButton
                isActive={isActive(link.href)}
                render={<Link href={link.href} />}
              >
                <link.icon className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1">{link.label}</span>
                {link.shortcutKey && (
                  <kbd className="ml-auto text-[10px] text-muted-foreground/60 font-mono" aria-hidden="true">
                    {modifier}{link.shortcutKey}
                  </kbd>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const providerOptions: { value: ProviderFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "claude", label: "Claude", icon: Sparkles },
  { value: "codex", label: "Codex", icon: Bot },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [modifier] = useState(detectModifier);
  const { provider, setProvider } = useProvider();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <Sidebar aria-label="Main navigation">
      <SidebarHeader className="py-2" style={{ paddingLeft: 16, paddingRight: 8 }}>
        <Logo className="-ml-0.5" />
        <p className="text-[10px] text-muted-foreground leading-none">Agent OS</p>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Monitor" links={monitorLinks} isActive={isActive} modifier={modifier} />
        <NavGroup label="Analytics" links={analyticsLinks} isActive={isActive} modifier={modifier} />
        <NavGroup label="Automation" links={automationLinks} isActive={isActive} modifier={modifier} />
      </SidebarContent>
      <SidebarFooter className="px-2 py-2 space-y-3">
        <div className="min-w-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Provider</span>
          <div className="flex items-stretch rounded-md border bg-muted/50 p-px mt-1.5" role="radiogroup" aria-label="Provider selection">
            {providerOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`flex-1 flex items-center justify-center rounded-sm py-1.5 text-[11px] font-medium transition-colors ${
                  provider === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setProvider(opt.value)}
                role="radio"
                aria-checked={provider === opt.value}
                aria-label={opt.label}
                title={opt.label}
              >
                <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <div className="border-t pt-2">
          <SystemStatusBar />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
