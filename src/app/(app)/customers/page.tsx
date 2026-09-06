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
  const [query, setQuery] = useState("");

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
          <Button onClick={() => setShowModal(true)}>
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
                      <Badge variant="default">Inactif</Badge>
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
          onClose={() => setShowModal(false)}
          onSave={handleCreate}
        />
      )}
    </div>
  );
}

function CustomerModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: NewCustomerInput) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
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
      aria-label="Ajouter un client"
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">
              Ajouter un client
            </h2>
            <p className="text-sm text-muted mt-1">
              Un numéro de référence (CLI-XXXX) sera attribué automatiquement.
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
            </label>
            <input
              id="cust-phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+229 ..."
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
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
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Ajouter"
            )}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
