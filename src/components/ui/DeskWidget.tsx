"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type WidgetLink = { href: string; label: string };

function WidgetMenu({ items }: { items: WidgetLink[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--text-primary)]"
        aria-label="Widget actions"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="2.5" r="1.1" fill="currentColor" />
          <circle cx="7" cy="7" r="1.1" fill="currentColor" />
          <circle cx="7" cy="11.5" r="1.1" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[12.5rem] rounded-lg border border-[var(--panel-border)] bg-[var(--quote-bg)] p-1"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className="block rounded-md px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-alt)] hover:text-[var(--text-primary)]"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function DeskWidget({
  title,
  status = "Latest end-of-day print",
  menu,
  children,
  footer,
  className = "",
}: {
  title: string;
  status?: string | null;
  menu?: WidgetLink[];
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`desk-widget ${className}`}>
      <header className="flex items-center gap-2 px-4 pt-4 sm:px-5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h2>
        {status && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--accent-bear)" }}
            title={status}
            aria-label={status}
          />
        )}
        {menu && menu.length > 0 && (
          <div className="ml-auto">
            <WidgetMenu items={menu} />
          </div>
        )}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
      {footer && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--panel-border)] px-4 py-2.5 text-[10px] text-[var(--text-muted)] sm:px-5">
          {footer}
        </footer>
      )}
    </section>
  );
}
