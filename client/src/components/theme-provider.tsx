import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const THEMES = [
  { id: "obsidian-gold", label: "Obsidian Gold", preview: "bg-[#0f0f0f]", accent: "bg-[#c7922a]" },
  { id: "ocean-blue", label: "Ocean Blue", preview: "bg-[#f5f7fa]", accent: "bg-[#2563eb]" },
  { id: "emerald", label: "Emerald", preview: "bg-[#0d1a15]", accent: "bg-[#10b981]" },
  { id: "slate-rose", label: "Slate Rose", preview: "bg-white", accent: "bg-[#e11d63]" },
] as const;

export type ThemeId = typeof THEMES[number]["id"];

interface ThemeContext {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const Ctx = createContext<ThemeContext>({ theme: "obsidian-gold", setTheme: () => {} });

const STORAGE_KEY = "pol263-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "obsidian-gold";
    return (localStorage.getItem(STORAGE_KEY) as ThemeId) || "obsidian-gold";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <Ctx.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
