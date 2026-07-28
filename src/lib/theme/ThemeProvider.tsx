"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "neon" | "paper";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "neon", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("neon");

  useEffect(() => {
    const stored = localStorage.getItem("kovaview-theme") as Theme | null;
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kovaview-theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "neon" ? "paper" : "neon"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
