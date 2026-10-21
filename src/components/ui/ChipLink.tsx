import Link from "next/link";
import type { ReactNode } from "react";

type ChipLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

export function ChipLink({ href, children, className = "" }: ChipLinkProps) {
  return (
    <Link href={href} className={`chip-link ${className}`}>
      {children}
    </Link>
  );
}

export function StatPill({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="stat-pill font-terminal text-xs">
      <span className="text-[var(--text-muted)] tracking-wider mr-2">{label}</span>
      <span style={{ color: valueColor }}>{value}</span>
    </div>
  );
}
