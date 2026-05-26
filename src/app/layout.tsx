import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SearchDialog } from "@/components/search-dialog";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { AppFooter } from "@/components/app-footer";
import { themeBootstrapScript } from "@/hooks/use-theme";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ingentive Agent OS",
  description: "AI Agent Management Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Start with dark mode to avoid a flash before the bootstrap script
      // runs. The script (below) reads localStorage / OS preference and
      // overrides this class before paint.
      className={`${roboto.variable} ${robotoMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-roboto)]" suppressHydrationWarning>
        {/*
          Theme bootstrap: a server-rendered inline script that sets the
          correct theme class on <html> before React hydrates, eliminating
          the flash of incorrect theme. Uses next/script with the
          beforeInteractive strategy so it's executed before our app code.
          The script body is a static literal from use-theme.tsx — no user
          input is interpolated into it.
        */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
        <Providers>
          <SidebarProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-background focus:text-foreground focus:border focus:rounded-md focus:m-2"
            >
              Skip to main content
            </a>
            <KeyboardShortcuts />
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-10 shrink-0 items-center justify-between border-b px-3" aria-label="Top navigation">
                <SidebarTrigger className="-ml-1" />
                <SearchDialog />
              </header>
              <main id="main-content" className="flex-1 p-4" aria-label="Main content">{children}</main>
              <AppFooter />
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
