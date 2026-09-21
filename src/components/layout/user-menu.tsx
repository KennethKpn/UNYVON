"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings, User, X } from "lucide-react";
import { useOrg } from "@/lib/context/org-context";
import { signOutAction } from "@/lib/supabase/auth-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function getInitials(
  firstName: string,
  lastName: string,
  email: string
): string {
  if (firstName || lastName) {
    return ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "U";
  }
  return email?.[0]?.toUpperCase() ?? "U";
}

function getDisplayName(
  firstName: string,
  lastName: string,
  email: string
): string {
  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }
  return email?.split("@")[0] ?? "Utilisateur";
}

export function UserMenu() {
  const { organization, user } = useOrg();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = getDisplayName(
    user?.firstName ?? "",
    user?.lastName ?? "",
    user?.email ?? ""
  );
  const initials = getInitials(
    user?.firstName ?? "",
    user?.lastName ?? "",
    user?.email ?? ""
  );

  // Fermeture au clic extérieur + touche Échap.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Bouton avatar/nom — réellement cliquable, ouvre le menu. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu utilisateur — ${displayName}`}
        data-testid="user-menu-trigger"
        className="flex items-center gap-2 pl-3 border-l border-border rounded-[10px] py-1 pr-1 hover:bg-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="w-8 h-8 rounded-full bg-lavender-soft flex items-center justify-center shrink-0">
          <span className="text-primary font-display font-semibold text-xs">
            {initials}
          </span>
        </div>
        <div className="hidden lg:block text-left">
          <p className="text-sm font-medium text-ink leading-tight">
            {displayName}
          </p>
          <p className="text-xs text-muted leading-tight">
            {organization?.name ?? ""}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu utilisateur"
          data-testid="user-menu"
          className="absolute right-0 top-full mt-2 w-64 bg-surface rounded-card border border-border shadow-lg py-2 z-50"
        >
          <div className="px-4 py-2 border-b border-border">
            <p className="text-sm font-medium text-ink truncate">
              {displayName}
            </p>
            <p className="text-xs text-muted truncate">
              {user?.email ?? ""}
            </p>
            {organization?.name && (
              <p className="text-xs text-muted truncate mt-1">
                {organization.name}
              </p>
            )}
          </div>

          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-background transition-colors"
          >
            <User className="w-4 h-4 text-muted" />
            Profil
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-background transition-colors"
          >
            <Settings className="w-4 h-4 text-muted" />
            Paramètres
          </Link>

          <div className="my-2 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-signout"
            onClick={() => {
              setOpen(false);
              setConfirmOpen(true);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error/5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      )}

      {/* Confirmation avant déconnexion : Annuler / Se déconnecter. */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmer la déconnexion"
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className="font-display font-semibold text-lg text-ink">
                  Se déconnecter ?
                </h2>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  aria-label="Fermer"
                  className="p-1.5 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-muted mb-6">
                Vous allez être déconnecté de votre session UNYVON. Voulez-vous
                continuer ?
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setConfirmOpen(false)}
                  data-testid="signout-cancel"
                >
                  Annuler
                </Button>
                <form action={signOutAction}>
                  <Button
                    type="submit"
                    data-testid="signout-confirm"
                    className="bg-error hover:bg-error/90 text-white"
                  >
                    <LogOut className="w-4 h-4" />
                    Se déconnecter
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
