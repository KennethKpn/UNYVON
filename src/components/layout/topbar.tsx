"use client";

import { Menu } from "lucide-react";
import { UserMenu } from "@/components/layout/user-menu";

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  return (
    <header className="h-16 border-b border-border bg-surface/80 backdrop-blur-lg flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          aria-label="Ouvrir le menu"
          className="md:hidden p-2 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </header>
  );
}

