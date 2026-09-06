"use client";

import { useEffect, useState } from "react";
import { Plus, X, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/context/org-context";
import {
  getTeamMembersAction,
  type TeamMember,
} from "@/lib/supabase/team-actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  manager: "Manager",
  seller: "Vendeur",
  stockkeeper: "Magasinier",
  member: "Membre",
};

const roleColors: Record<string, string> = {
  owner: "bg-primary/10 text-primary",
  manager: "bg-info/10 text-info",
  seller: "bg-success/10 text-success",
  stockkeeper: "bg-warning/10 text-warning",
  member: "bg-muted/10 text-muted",
};

export default function TeamPage() {
  const { organization, user, permissions } = useOrg();
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;

    async function load() {
      const result = await getTeamMembersAction(organization!.id);
      if (cancelled) return;
      if (result.ok) {
        setMembers(result.members);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organization]);

  function getMemberLabel(m: TeamMember) {
    if (m.userId === user?.id) return "Vous";
    return "Membre";
  }

  function getMemberInitials(m: TeamMember) {
    if (m.userId === user?.id) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
      if (name) {
        return name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase();
      }
      return user.email?.[0]?.toUpperCase() ?? "M";
    }
    return m.userId.slice(0, 2).toUpperCase();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Équipe</h1>
          <p className="text-sm text-muted mt-1">
            {loading ? "Chargement..." : `${members.length} membre${members.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {permissions?.canManageTeam && (
          <Button onClick={() => setShowInvite(true)}>
            <Plus className="w-4 h-4" />
            Inviter un membre
          </Button>
        )}
      </div>

      <Card variant="elevated">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Membre
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Rôle
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-6 py-12 text-center text-sm text-muted">
                    Chargement de l&apos;équipe...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-12 text-center">
                    <Users className="w-10 h-10 text-muted/40 mx-auto mb-3" />
                    <p className="text-sm text-muted">
                      Aucun membre trouvé dans cette organisation.
                    </p>
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.userId}
                    className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-lavender-soft flex items-center justify-center">
                          <span className="text-primary font-display font-semibold text-xs">
                            {getMemberInitials(member)}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {getMemberLabel(member)}
                          </p>
                          <p className="text-xs text-muted font-mono">
                            {member.userId.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={roleColors[member.role] ?? roleColors.member}>
                        {ROLE_LABELS[member.role] ?? member.role}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardContent>
          <h3 className="font-display font-semibold text-sm text-ink mb-2">
            Rôles et permissions
          </h3>
          <div className="space-y-2 text-xs text-muted">
            <p>
              <strong className="text-text">Propriétaire :</strong> Accès complet,
              abonnements, utilisateurs, paramètres.
            </p>
            <p>
              <strong className="text-text">Manager :</strong> Supervision des
              opérations et rapports.
            </p>
            <p>
              <strong className="text-text">Vendeur :</strong> Ventes et consultation
              limitée.
            </p>
            <p>
              <strong className="text-text">Magasinier :</strong> Stock, réceptions et
              inventaires.
            </p>
          </div>
        </CardContent>
      </Card>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Inviter un membre"
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-md">
              <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
                <div>
                  <h2 className="font-display font-semibold text-lg text-ink">
                    Inviter un membre
                  </h2>
                  <p className="text-sm text-muted mt-1">
                    Envoyer une invitation par e-mail
                  </p>
                </div>
                <button
                  onClick={() => setShowInvite(false)}
                  aria-label="Fermer"
                  className="p-2 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-muted">
                  Les invitations d&apos;équipe seront bientôt disponibles.
                </p>
              </div>

              <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
                <Button onClick={() => setShowInvite(false)}>
                  Fermer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
