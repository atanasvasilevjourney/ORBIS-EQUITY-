"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FOCUS_UNIVERSE_CHANGED,
  addFocusSymbol,
  appendFocusQuery,
  focusSymbolsQueryParam,
  getFocusSymbols,
  getUniverseMode,
  removeFocusSymbol,
  setFocusSymbols,
  setUniverseMode,
  type UniverseMode,
} from "@/lib/focusUniverse";

export function useFocusUniverse() {
  const [mode, setModeState] = useState<UniverseMode>("index");
  const [symbols, setSymbolsState] = useState<string[]>([]);

  const sync = useCallback(() => {
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

  const symbolsParam = mode === "focus" ? focusSymbolsQueryParam() : "";

  return {
    mode,
    symbols,
    symbolsParam,
    isFocusActive: mode === "focus" && symbols.length > 0,
    setMode,
    addSymbol: add,
    removeSymbol: remove,
    setSymbols: replaceAll,
    appendFocusQuery,
  };
}
