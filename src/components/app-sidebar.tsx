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
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: Terminal },
  { href: "/awaiting", label: "Awaiting Input", icon: Bell },
  { href: "/projects", label: "Projects", icon: FolderOpen },
];

const analyticsLinks = [
  { href: "/tokens", label: "Token Usage", icon: BarChart3 },
];

const automationLinks = [
  { href: "/tasks", label: "Scheduled Tasks", icon: Clock },
];

function NavGroup({
  label,
  links,
  isActive,
}: {
  label: string;
  links: typeof monitorLinks;
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
                <link.icon className="h-4 w-4" />
                <span>{link.label}</span>
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
    <Sidebar>
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
