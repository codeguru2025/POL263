import { THEMES, useTheme, type ThemeId } from "./theme-provider";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Change theme">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setTheme(t.id as ThemeId)}
            className={`gap-3 cursor-pointer ${theme === t.id ? "font-semibold" : ""}`}
          >
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`h-4 w-4 rounded-full border ${t.preview}`} />
              <span className={`h-4 w-4 rounded-full border ${t.accent}`} />
            </div>
            <span className="truncate">{t.label}</span>
            {theme === t.id && <span className="ml-auto text-primary text-xs">Active</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
