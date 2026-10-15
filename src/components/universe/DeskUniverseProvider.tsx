"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  dismissFirstAddNudge,
  isFirstAddNudgeDismissed,
  FOCUS_UNIVERSE_CHANGED,
  getFocusSymbols,
  getUniverseMode,
} from "@/lib/focusUniverse";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { DeskUniverseDrawer } from "@/components/universe/DeskUniverseDrawer";
import { DeskUniverseUiContext } from "@/components/universe/deskUniverseUiContext";

export { useDeskUniverseUi } from "@/components/universe/deskUniverseUiContext";

export function DeskUniverseProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const { setMode } = useFocusUniverse();
  const prevSymbolCount = useRef<number | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (searchParams.get("desk") === "edit") {
      setDrawerOpen(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("desk");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  useEffect(() => {
    prevSymbolCount.current = getFocusSymbols().length;
    const onChanged = () => {
      const count = getFocusSymbols().length;
      const prev = prevSymbolCount.current ?? 0;
      prevSymbolCount.current = count;
      if (prev === 0 && count === 1 && getUniverseMode() === "index" && !isFirstAddNudgeDismissed()) {
        setShowNudge(true);
      }
    };
    window.addEventListener(FOCUS_UNIVERSE_CHANGED, onChanged);
    return () => window.removeEventListener(FOCUS_UNIVERSE_CHANGED, onChanged);
  }, []);

  const acceptFirstAddNudge = useCallback(() => {
    setMode("focus");
    dismissFirstAddNudge();
    setShowNudge(false);
  }, [setMode]);

  const dismissFirstAddNudgeUi = useCallback(() => {
    dismissFirstAddNudge();
    setShowNudge(false);
  }, []);

  return (
    <DeskUniverseUiContext.Provider
      value={{
        drawerOpen,
        openDrawer,
        closeDrawer,
        showFirstAddNudge: showNudge,
        acceptFirstAddNudge,
        dismissFirstAddNudgeUi,
      }}
    >
      {children}
      <DeskUniverseDrawer open={drawerOpen} onClose={closeDrawer} />
    </DeskUniverseUiContext.Provider>
  );
}
