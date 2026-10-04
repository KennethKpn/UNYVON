"use client";

import Link from "next/link";
import { FileUp, Menu } from "lucide-react";
import { UserMenu } from "@/components/layout/user-menu";
import { useOrg } from "@/lib/context/org-context";

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const { permissions } = useOrg();

  return (
    <header className="h-16 border-b border-border bg-surface/80 backdrop-blur-lg flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          aria-label="Ouvrir le menu"
          className="md:hidden min-h-[44px] min-w-[44px] p-3 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors flex items-center justify-center"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {permissions?.canManageOrganization && (
          <Link
            href="/import"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-primary/20 bg-lavender-soft px-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            <span className="hidden sm:inline">Gagner du temps</span>
            <span className="sm:hidden">Importer</span>
          </Link>
        )}
        <UserMenu />
      </div>
    </header>
  );
}

