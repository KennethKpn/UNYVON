"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Phone,
  MapPin,
  Mail,
  StickyNote,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Pencil,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp, type NewCustomerInput } from "@/lib/context/app-context";
import { useOrg } from "@/lib/context/org-context";
import { cn, formatFCFA } from "@/lib/utils";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  restoreCustomer,
  findCustomerPhoneMatches,
} from "@/lib/supabase/customer-actions";
import { SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import type { Customer } from "@/types";

type ViewCustomer = Customer & { source: "supabase" | "mock" };

function getCustomerRef(id: string | null): string {
  if (!id) return "CLI-----";
  const hex = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `CLI-${hex}`;
}

export default function CustomersPage() {
  const { customers: mockCustomers, addCustomer } = useApp();
  const { permissions } = useOrg();
  const [customers, setCustomers] = useState<ViewCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"supabase" | "mock">("mock");
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<ViewCustomer | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getCustomers();
        if (cancelled) return;
        setCustomers(
          data.map((c) => ({ ...c, source: "supabase" as const }))
        );
        setSource("supabase");
      } catch (e) {
        if (cancelled) return;
        const isNotConfigured =
          e instanceof Error && e.message === SUPABASE_NOT_CONFIGURED_MESSAGE;
        if (isNotConfigured) {
          const fallback: ViewCustomer[] = mockCustomers.map((c) => ({
            ...c,
            source: "mock" as const,
          }));
          setCustomers(fallback);
          setSource("mock");
        } else {
          setSource("supabase");
          setError(
            e instanceof Error ? e.message : "Erreur de chargement des clients"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [mockCustomers]);

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  const totalReceivables = customers.reduce(
    (sum, c) => sum + c.outstandingBalance,
    0
  );

  async function handleCreate(input: NewCustomerInput) {
    if (source === "supabase") {
      try {
        const created = await createCustomer(input);
        setCustomers((prev) => [
          { ...created, source: "supabase" as const },
          ...prev,
        ]);
        return;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erreur lors de la création"
        );
        return;
      }
    }
    const local = addCustomer(input);
    setCustomers((prev) => [{ ...local, source: "mock" as const }, ...prev]);
  }

  async function handleUpdate(
    input: NewCustomerInput
  ): Promise<{ ok: boolean; duplicateNames?: string[] }> {
    if (!editCustomer) return { ok: false };
    if (source === "supabase") {
      try {
        const updated = await updateCustomer({
          id: editCustomer.id,
          ...input,
        });
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === updated.id
              ? {
                  ...updated,
                  totalPurchases: c.totalPurchases,
                  outstandingBalance: c.outstandingBalance,
                  source: "supabase" as const,
                }
              : c
          )
        );
        return { ok: true };
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erreur lors de la modification"
        );
        return { ok: false };
      }
    }
    return { ok: false };
  }

  /**
   * Archivage (is_active=false) : PAS de suppression physique afin de
   * conserver l'historique des ventes et créances rattachées au client.
   */
  async function handleArchive(id: string) {
    if (source !== "supabase") return;
    const target = customers.find((c) => c.id === id);
    if (target && target.outstandingBalance > 0) {
      setError(
        `Impossible d'archiver ${target.name} : il reste ${formatFCFA(
          target.outstandingBalance
        )} de créance à recouvrer. Encaissez le solde ou enregistrez un paiement avant d'archiver.`
      );
      return;
    }
    try {
      setBusyId(id);
      await archiveCustomer(id);
      setCustomers((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isActive: false } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur archivage");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id: string) {
    if (source !== "supabase") return;
    try {
      setBusyId(id);
      await restoreCustomer(id);
      setCustomers((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isActive: true } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur restauration");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Clients</h1>
          <p className="text-sm text-muted mt-1">
            {customers.length} client{customers.length > 1 ? "s" : ""}
            {totalReceivables > 0
              ? ` · Créances totales : ${formatFCFA(totalReceivables)}`
              : ""}
          </p>
        </div>
        {permissions?.canManageCustomers && (
          <Button
            onClick={() => {
              setEditCustomer(null);
              setShowModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Ajouter un client
          </Button>
        )}
      </div>

      {source === "mock" && !loading && (
        <div className="flex items-center gap-2 text-xs text-info bg-info/5 border border-info/20 rounded-[10px] px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Mode démo — connectez Supabase pour persister les données
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-error bg-error/5 border border-error/20 rounded-[10px] px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 h-9 px-3 rounded-[10px] border border-border bg-surface max-w-sm">
        <Search className="w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Rechercher un client..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher un client"
          className="flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((customer) => (
            <Card
              key={customer.id}
              variant="elevated"
              className="hover:shadow-md transition-shadow"
            >
              <CardContent>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-display font-semibold text-ink">
                      {customer.name}
                    </h3>
                    <p className="text-[11px] text-muted font-mono mt-0.5">
                      {getCustomerRef(customer.id)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                      <Phone className="w-3 h-3" />
                      {customer.phone || "—"}
                    </div>
                    {customer.email && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                        <Mail className="w-3 h-3" />
                        {customer.email}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                      <MapPin className="w-3 h-3" />
                      {customer.address || "—"}
                    </div>
                    {customer.notes && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                        <StickyNote className="w-3 h-3" />
                        {customer.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {customer.outstandingBalance > 0 && (
                      <Badge variant="warning">Créance</Badge>
                    )}
                    {!customer.isActive && (
                      <Badge variant="default">Archivé</Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border">
                  <div>
                    <p className="text-xs text-muted">Total achats</p>
                    <p className="text-sm font-semibold text-ink mt-0.5">
                      {formatFCFA(customer.totalPurchases)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Solde dû</p>
                    <p
                      className={cn(
                        "text-sm font-semibold mt-0.5",
                        customer.outstandingBalance > 0
                          ? "text-warning"
                          : "text-success"
                      )}
                    >
                      {formatFCFA(customer.outstandingBalance)}
                    </p>
                  </div>
                </div>

                {customer.outstandingBalance > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">
                        Ancienneté créance
                      </span>
                      <Badge
                        variant={
                          customer.outstandingBalance > 300000
                            ? "error"
                            : "warning"
                        }
                      >
                        {customer.outstandingBalance > 300000
                          ? "30+ jours"
                          : "8–30 jours"}
                      </Badge>
                    </div>
                  </div>
                )}

                {source === "supabase" && permissions?.canManageCustomers && (
                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-end gap-1">
                    {customer.isActive ? (
                      <>
                        <button
                          onClick={() => {
                            setEditCustomer(customer);
                            setShowModal(true);
                          }}
                          aria-label={`Modifier ${customer.name}`}
                          className="flex items-center gap-1 px-2 py-1 rounded-[8px] text-xs text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Modifier
                        </button>
                        <button
                          onClick={() => handleArchive(customer.id)}
                          disabled={busyId === customer.id}
                          aria-label={`Archiver ${customer.name}`}
                          title="Archiver — l'historique des ventes est conservé"
                          className="flex items-center gap-1 px-2 py-1 rounded-[8px] text-xs text-muted hover:text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        >
                          {busyId === customer.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                          Archiver
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleRestore(customer.id)}
                        disabled={busyId === customer.id}
                        aria-label={`Restaurer ${customer.name}`}
                        className="flex items-center gap-1 px-2 py-1 rounded-[8px] text-xs text-muted hover:text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                      >
                        {busyId === customer.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ArchiveRestore className="w-3.5 h-3.5" />
                        )}
                        Restaurer
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted">
                {query ? "Aucun client ne correspond à votre recherche." : "Aucun client trouvé."}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {showModal && (
        <CustomerModal
          editCustomer={editCustomer}
          onClose={() => {
            setShowModal(false);
            setEditCustomer(null);
          }}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}

function CustomerModal({
  editCustomer,
  onClose,
  onCreate,
  onUpdate,
}: {
  editCustomer: ViewCustomer | null;
  onClose: () => void;
  onCreate: (input: NewCustomerInput) => void | Promise<void>;
  onUpdate: (
    input: NewCustomerInput
  ) => Promise<{ ok: boolean; duplicateNames?: string[] }>;
}) {
  const [name, setName] = useState(editCustomer?.name ?? "");
  const [phone, setPhone] = useState(editCustomer?.phone ?? "");
  const [email, setEmail] = useState(editCustomer?.email ?? "");
  const [address, setAddress] = useState(editCustomer?.address ?? "");
  const [notes, setNotes] = useState(editCustomer?.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Détection de doublons téléphone DANS l'organisation (aucune unicité
  // globale imposée) : simple avertissement, décision explicite possible.
  const [dupWarning, setDupWarning] = useState<{
    names: string[];
    acknowledged: boolean;
  } | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);

  const isEdit = !!editCustomer;
  const canSubmit = name.trim().length > 0 && !saving && !checkingPhone;

  const checkPhoneDuplicate = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setDupWarning(null);
      return;
    }
    setCheckingPhone(true);
    try {
      const matches = await findCustomerPhoneMatches(
        trimmed,
        editCustomer?.id
      );
      const names = matches.map((m) => m.name);
      if (names.length > 0) {
        // Conserver l'acquittement si le même avertissement est déjà connu.
        setDupWarning((prev) =>
          prev &&
          prev.names.join("|") === names.join("|") &&
          prev.acknowledged
            ? prev
            : { names, acknowledged: false }
        );
      } else {
        setDupWarning(null);
      }
    } catch {
      // La détection ne doit jamais bloquer la saisie.
      setDupWarning(null);
    } finally {
      setCheckingPhone(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // En création, on propose explicitement de confirmer si doublon détecté.
    if (dupWarning && !dupWarning.acknowledged) {
      setDupWarning({ ...dupWarning, acknowledged: true });
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      };
      if (isEdit) {
        const res = await onUpdate(input);
        if (!res.ok) return;
      } else {
        await onCreate(input);
      }
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Modifier un client" : "Ajouter un client"}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">
              {isEdit ? "Modifier le client" : "Ajouter un client"}
            </h2>
            <p className="text-sm text-muted mt-1">
              {isEdit
                ? "Mettre à jour les informations du client."
                : "Un numéro de référence (CLI-XXXX) sera attribué automatiquement."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label
              htmlFor="cust-name"
              className="text-sm font-medium text-text block mb-1.5"
            >
              Nom *
            </label>
            <input
              id="cust-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Épicerie du Marché"
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label
              htmlFor="cust-phone"
              className="text-sm font-medium text-text block mb-1.5"
            >
              Téléphone
              {checkingPhone && (
                <Loader2 className="w-3 h-3 animate-spin inline ml-2 text-muted" />
              )}
            </label>
            <input
              id="cust-phone"
              type="text"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                void checkPhoneDuplicate(e.target.value);
              }}
              onBlur={() => void checkPhoneDuplicate(phone)}
              placeholder="+229 ..."
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {dupWarning && (
              <div
                role="alert"
                className="mt-2 p-3 rounded-[10px] bg-warning/10 border border-warning/30"
              >
                <p className="text-xs text-warning flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {dupWarning.names.length === 1
                      ? "Ce numéro est déjà utilisé par "
                      : "Ce numéro est déjà utilisé par "}
                    <strong>{dupWarning.names.join(", ")}</strong>. Vérifiez
                    qu&apos;il ne s&apos;agit pas d&apos;un doublon.
                  </span>
                </p>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="cust-email"
              className="text-sm font-medium text-text block mb-1.5"
            >
              E-mail
            </label>
            <input
              id="cust-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@exemple.com"
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label
              htmlFor="cust-address"
              className="text-sm font-medium text-text block mb-1.5"
            >
              Adresse
            </label>
            <input
              id="cust-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Quartier, ville"
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label
              htmlFor="cust-notes"
              className="text-sm font-medium text-text block mb-1.5"
            >
              Notes
            </label>
            <textarea
              id="cust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informations complémentaires..."
              rows={3}
              className="w-full px-4 py-3 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>
        </div>

        <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            title={
              dupWarning && !dupWarning.acknowledged
                ? "Numéro déjà utilisé — confirmez pour continuer"
                : undefined
            }
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {dupWarning && !dupWarning.acknowledged
              ? "Confirmer malgré le doublon"
              : isEdit
              ? "Enregistrer"
              : "Ajouter"}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
