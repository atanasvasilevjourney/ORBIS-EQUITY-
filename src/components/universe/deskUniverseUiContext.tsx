"use client";

import { createContext, useContext } from "react";

export type DeskUniverseUiContext = {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  showFirstAddNudge: boolean;
  acceptFirstAddNudge: () => void;
  dismissFirstAddNudgeUi: () => void;
};

export const DeskUniverseUiContext = createContext<DeskUniverseUiContext | null>(null);

export function useDeskUniverseUi(): DeskUniverseUiContext {
  const ctx = useContext(DeskUniverseUiContext);
  if (!ctx) {
    throw new Error("useDeskUniverseUi must be used within DeskUniverseProvider");
  }
  return ctx;
}
