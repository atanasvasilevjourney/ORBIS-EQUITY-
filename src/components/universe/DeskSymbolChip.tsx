"use client";

import Link from "next/link";

type Props = {
  symbol: string;
  /** When set, show remove control (editor / drawer only). */
  onRemove?: () => void;
  accent?: string;
  className?: string;
};

export function DeskSymbolChip({ symbol, onRemove, accent = "var(--accent-desk)", className = "" }: Props) {
  return (
    <span
      className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-terminal ${className}`}
      style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--panel-border))` }}
    >
      <Link
        href={`/ticker/${symbol}`}
        className="font-semibold hover:underline"
        style={{ color: accent }}
      >
        {symbol}
      </Link>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${symbol}`}
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--accent-danger)] transition-opacity"
        >
          ×
        </button>
      )}
    </span>
  );
}
