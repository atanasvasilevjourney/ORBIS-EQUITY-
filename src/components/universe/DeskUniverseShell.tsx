"use client";

import { Suspense, type ReactNode } from "react";
import { DeskUniverseProvider } from "@/components/universe/DeskUniverseProvider";

export function DeskUniverseShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DeskUniverseProvider>{children}</DeskUniverseProvider>
    </Suspense>
  );
}
