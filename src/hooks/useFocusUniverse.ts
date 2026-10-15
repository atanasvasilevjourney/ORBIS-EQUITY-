"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FOCUS_UNIVERSE_CHANGED,
  addFocusSymbol,
  appendFocusQuery,
  focusSymbolsQueryParam,
  getFocusSymbols,
  getUniverseDeskId,
  getUniverseMode,
  removeFocusSymbol,
  setFocusSymbols,
  setUniverseDeskId,
  setUniverseMode,
  universeDeskApiParam,
  type UniverseMode,
} from "@/lib/focusUniverse";
import type { UniverseDeskId } from "@/lib/universeDesk";
import { DESK_LABELS, isWatchlistDesk } from "@/lib/universeDesk";

export function useFocusUniverse() {
  const [mode, setModeState] = useState<UniverseMode>("index");
  const [desk, setDeskState] = useState<UniverseDeskId>("sp500_ndx100");
  const [symbols, setSymbolsState] = useState<string[]>([]);

  const sync = useCallback(() => {
    const d = getUniverseDeskId();
    setDeskState(d);
    setModeState(getUniverseMode());
    setSymbolsState(getFocusSymbols());
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(FOCUS_UNIVERSE_CHANGED, sync);
    return () => window.removeEventListener(FOCUS_UNIVERSE_CHANGED, sync);
  }, [sync]);

  const setMode = useCallback((m: UniverseMode) => {
    setUniverseMode(m);
    sync();
  }, [sync]);

  const setDesk = useCallback((d: UniverseDeskId) => {
    setUniverseDeskId(d);
    sync();
  }, [sync]);

  const add = useCallback((sym: string) => {
    addFocusSymbol(sym);
    sync();
  }, [sync]);

  const remove = useCallback((sym: string) => {
    removeFocusSymbol(sym);
    sync();
  }, [sync]);

  const replaceAll = useCallback((list: string[]) => {
    setFocusSymbols(list);
    sync();
  }, [sync]);

  const symbolsParam = isWatchlistDesk(desk) ? focusSymbolsQueryParam() : "";
  const universeParam = universeDeskApiParam();
  const deskLabel = DESK_LABELS[desk];

  return {
    mode,
    desk,
    deskLabel,
    symbols,
    symbolsParam,
    universeParam,
    isFocusActive: isWatchlistDesk(desk) && symbols.length > 0,
    isWatchlist: isWatchlistDesk(desk),
    setMode,
    setDesk,
    addSymbol: add,
    removeSymbol: remove,
    setSymbols: replaceAll,
    appendFocusQuery,
  };
}
