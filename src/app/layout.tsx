import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SearchDialog } from "@/components/search-dialog";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { AppFooter } from "@/components/app-footer";

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
  description: "Claude Code Management Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-roboto)]">
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
