import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="section-label mb-2 flex items-center gap-2">
      <span className="section-label-dot" aria-hidden />
      {children}
    </h2>
  );
}
