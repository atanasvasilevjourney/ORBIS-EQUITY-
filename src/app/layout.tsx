import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { DataHonestyBar } from "@/components/cards/DataHonestyBar";
import { ThemeToggle } from "@/components/cards/ThemeToggle";

export const metadata: Metadata = {
  title: "KovaView Terminal",
  description: "Equity swing terminal — momentum, fundamentals, pharma pipeline, earnings & news",
};

function Nav() {
  const links = [
    { href: "/screener", label: "SCREENER" },
    { href: "/fundamentals", label: "FUNDAMENTALS" },
    { href: "/pharma", label: "PHARMA PIPELINE" },
    { href: "/earnings-news", label: "EARNINGS & NEWS" },
  ];

  return (
    <nav className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-lg font-bold font-terminal tracking-widest" style={{ color: "var(--accent-info)" }}>
          KOVAVIEW
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-3 py-1.5 text-xs font-terminal rounded hover:bg-[var(--surface-alt)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
      </div>
    </nav>
  );
}

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
