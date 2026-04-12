"use client";

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
const monitorLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "⌘1" },
  { href: "/sessions", label: "Sessions", icon: Terminal, shortcut: "⌘2" },
  { href: "/awaiting", label: "Awaiting Input", icon: Bell, shortcut: "⌘3" },
  { href: "/projects", label: "Projects", icon: FolderOpen, shortcut: "⌘4" },
];

const analyticsLinks = [
  { href: "/tokens", label: "Token Usage", icon: BarChart3, shortcut: "⌘5" },
  { href: "/history", label: "Session History", icon: History, shortcut: "⌘6" },
];

const automationLinks = [
  { href: "/tasks", label: "Scheduled Tasks", icon: Clock, shortcut: "⌘7" },
];

function NavGroup({
  label,
  links,
  isActive,
}: {
  label: string;
  links: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; shortcut?: string }>;
  isActive: (href: string) => boolean;
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
                {"shortcut" in link && (
                  <kbd className="ml-auto text-[10px] text-muted-foreground/60 font-mono" aria-hidden="true">
                    {link.shortcut}
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

export function AppSidebar() {
  const pathname = usePathname();

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
        <NavGroup label="Monitor" links={monitorLinks} isActive={isActive} />
        <NavGroup label="Analytics" links={analyticsLinks} isActive={isActive} />
        <NavGroup label="Automation" links={automationLinks} isActive={isActive} />
      </SidebarContent>
      <SidebarFooter className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
