import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { DataHonestyBar } from "@/components/cards/DataHonestyBar";
import { Nav } from "@/components/nav/Nav";

export const metadata: Metadata = {
  title: "KovaView Terminal",
  description: "Equity swing terminal — momentum, fundamentals, pharma pipeline, earnings & news",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="neon">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <Nav />
          <DataHonestyBar />
          <main className="mx-auto max-w-[1600px]">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
