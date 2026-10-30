import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { DataHonestyBar } from "@/components/cards/DataHonestyBar";
import { Nav } from "@/components/nav/Nav";
import { CommandPalette } from "@/components/command/CommandPalette";
import { DeskUniverseShell } from "@/components/universe/DeskUniverseShell";
import { DeskUniverseStrip } from "@/components/universe/DeskUniverseStrip";

export const metadata: Metadata = {
  title: "Orbis Equity Terminal",
  description: "Equity swing terminal — momentum, fundamentals, earnings & news",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-dvh overflow-hidden" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("orbis-equity-theme")||"neon";document.documentElement.setAttribute("data-theme",t);localStorage.setItem("orbis-equity-theme",t)}catch(e){}`,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Outfit:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="app-shell flex h-dvh min-h-0 flex-col overflow-hidden antialiased">
        <ThemeProvider>
          <DeskUniverseShell>
            <Nav />
            <DataHonestyBar />
            <DeskUniverseStrip />
            <main className="page-enter mx-auto flex w-full min-h-0 max-w-[1600px] flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 sm:px-4">
              {children}
            </main>
            <CommandPalette />
          </DeskUniverseShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
