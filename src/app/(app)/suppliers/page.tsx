"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  StickyNote,
  Truck,
  X,
  Pencil,
  Archive,
  RotateCcw,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/context/org-context";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  archiveSupplier,
  restoreSupplier,
  findSupplierPhoneMatches,
} from "@/lib/supabase/supplier-actions";
import { SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import type { Supplier } from "@/types";

export default function SuppliersPage() {
  const { permissions } = useOrg();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getSuppliers();
        if (cancelled) return;
        setSuppliers(data);
      } catch (e) {
        if (cancelled) return;
        if (
          e instanceof Error &&
          e.message === SUPABASE_NOT_CONFIGURED_MESSAGE
        ) {
          setNotConfigured(true);
        } else {
          setError(
            e instanceof Error
              ? e.message
              : "Erreur de chargement des fournisseurs"
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
  }, []);

  const filtered = suppliers.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.phone ?? "").toLowerCase().includes(q) ||
      (s.email ?? "").toLowerCase().includes(q)
    );
  });

  const activeSuppliers = filtered.filter((s) => s.isActive);
  const archivedSuppliers = filtered.filter((s) => !s.isActive);

  const handleCreate = async (input: {
    name: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
  }) => {
    const created = await createSupplier(input);
    setSuppliers((prev) => [created, ...prev]);
  };

  const handleUpdate = async (input: {
    name: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
  }) => {
    if (!editSupplier) return;
    const updated = await updateSupplier({ id: editSupplier.id, ...input });
    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === updated.id
          ? {
              ...s,
              name: updated.name,
              phone: updated.phone,
              email: updated.email,
              address: updated.address,
              notes: updated.notes,
            }
          : s
      )
    );
  };

  const handleArchive = async (id: string) => {
    try {
      setBusyId(id);
      await archiveSupplier(id);
      setSuppliers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: false } : s))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur archivage");
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      setBusyId(id);
      await restoreSupplier(id);
      setSuppliers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: true } : s))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur restauration");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              Fournisseurs
            </h1>
          </div>
        </div>
        <Card variant="elevated">
          <div className="flex items-center justify-center py-16 gap-3 text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Chargement des fournisseurs...</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            Fournisseurs
          </h1>
          <p className="text-sm text-muted mt-1">
            {activeSuppliers.length} fournisseur
            {activeSuppliers.length > 1 ? "s" : ""}
            {archivedSuppliers.length > 0 &&
              ` · ${archivedSuppliers.length} archivé(s)`}
          </p>
        </div>
        {permissions?.canManageSuppliers && (
          <Button
            onClick={() => {
              setEditSupplier(null);
              setShowModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Ajouter un fournisseur
          </Button>
        )}
      </div>

      {notConfigured && (
        <div className="flex items-center gap-2 text-xs text-info bg-info/5 border border-info/20 rounded-[10px] px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Mode démo — connectez Supabase pour persister les données
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-[10px] bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button
            onClick={() => setError("")}
            className="ml-auto p-1 rounded hover:bg-error/20"
            aria-label="Fermer l'erreur"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 h-9 px-3 rounded-[10px] border border-border bg-surface max-w-sm">
        <Search className="w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Rechercher un fournisseur..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher un fournisseur"
          className="flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <Card variant="elevated">
        <div className="overflow-x-auto">
              <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Fournisseur
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Téléphone
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  E-mail
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Adresse
                </th>
                <th className="text-center text-xs font-medium text-muted px-6 py-3">
                  Statut
                </th>
                <th className="text-center text-xs font-medium text-muted px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {activeSuppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-[10px] bg-lavender-soft flex items-center justify-center shrink-0">
                        <Truck className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-ink block">
                          {supplier.name}
                        </span>
                        {supplier.notes && (
                          <span className="text-xs text-muted flex items-center gap-1 mt-0.5">
                            <StickyNote className="w-3 h-3" />
                            {supplier.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted">
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3 h-3" />
                      {supplier.phone || "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted">
                    {supplier.email ? (
                      <span className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3" />
                        {supplier.email}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted">
                    {supplier.address ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3" />
                        {supplier.address}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge variant="success">Actif</Badge>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {permissions?.canManageSuppliers && (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditSupplier(supplier);
                            setShowModal(true);
                          }}
                          aria-label={`Modifier ${supplier.name}`}
                          className="p-1.5 rounded-[10px] text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleArchive(supplier.id)}
                          disabled={busyId === supplier.id}
                          aria-label={`Archiver ${supplier.name}`}
                          title="Archiver (l'historique des achats est conservé)"
                          className="p-1.5 rounded-[10px] text-muted hover:text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        >
                          {busyId === supplier.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Archive className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {activeSuppliers.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-sm text-muted"
                  >
                    {query
                      ? "Aucun fournisseur ne correspond à votre recherche."
                      : "Aucun fournisseur. Ajoutez votre premier fournisseur."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {archivedSuppliers.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted hover:text-text transition-colors">
            Fournisseurs archivés ({archivedSuppliers.length})
          </summary>
          <Card variant="elevated" className="mt-3">
            <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted px-6 py-3">
                      Fournisseur
                    </th>
                    <th className="text-left text-xs font-medium text-muted px-6 py-3">
                      Téléphone
                    </th>
                    <th className="text-left text-xs font-medium text-muted px-6 py-3">
                      E-mail
                    </th>
                    <th className="text-center text-xs font-medium text-muted px-6 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {archivedSuppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="border-b border-border last:border-0 opacity-60"
                    >
                      <td className="px-6 py-3 text-sm text-text">
                        {supplier.name}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted">
                        {supplier.phone || "—"}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted">
                        {supplier.email || "—"}
                      </td>
                      <td className="px-6 py-3 text-center">
                        {permissions?.canManageSuppliers && (
                          <button
                            onClick={() => handleRestore(supplier.id)}
                            disabled={busyId === supplier.id}
                            aria-label={`Restaurer ${supplier.name}`}
                            className="p-1.5 rounded-[10px] text-muted hover:text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                          >
                            {busyId === supplier.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </details>
      )}

      {showModal && (
        <SupplierModal
          editSupplier={editSupplier}
          onClose={() => {
            setShowModal(false);
            setEditSupplier(null);
          }}
          onSave={async (input) => {
            if (editSupplier) {
              await handleUpdate(input);
            } else {
              await handleCreate(input);
            }
          }}
        />
      )}
    </div>
  );
}

function SupplierModal({
  editSupplier,
  onClose,
  onSave,
}: {
  editSupplier: Supplier | null;
  onClose: () => void;
  onSave: (input: {
    name: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(editSupplier?.name ?? "");
  const [phone, setPhone] = useState(editSupplier?.phone ?? "");
  const [email, setEmail] = useState(editSupplier?.email ?? "");
  const [address, setAddress] = useState(editSupplier?.address ?? "");
  const [notes, setNotes] = useState(editSupplier?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [dupWarning, setDupWarning] = useState<{
    names: string[];
    acknowledged: boolean;
  } | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);

  const isEdit = !!editSupplier;
  const canSubmit = name.trim().length > 0 && !saving && !checkingPhone;

  const checkPhoneDuplicate = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setDupWarning(null);
      return;
    }
    setCheckingPhone(true);
    try {
      const matches = await findSupplierPhoneMatches(
        trimmed,
        editSupplier?.id
      );
      const names = matches.map((m) => m.name);
      if (names.length > 0) {
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
      setDupWarning(null);
    } finally {
      setCheckingPhone(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (dupWarning && !dupWarning.acknowledged) {
      setDupWarning({ ...dupWarning, acknowledged: true });
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Modifier un fournisseur" : "Ajouter un fournisseur"}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
            <div>
              <h2 className="font-display font-semibold text-lg text-ink">
                {isEdit ? "Modifier le fournisseur" : "Ajouter un fournisseur"}
              </h2>
              <p className="text-sm text-muted mt-1">
                {isEdit
                  ? "Mettre à jour les informations du fournisseur"
                  : "Référencer un partenaire d'approvisionnement"}
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
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-[10px] bg-error/10 text-error text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="sup-name"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Nom *
              </label>
              <input
                id="sup-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Grossiste Mimi"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div>
              <label
                htmlFor="sup-phone"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Téléphone
                {checkingPhone && (
                  <Loader2 className="w-3 h-3 animate-spin inline ml-2 text-muted" />
                )}
              </label>
              <input
                id="sup-phone"
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
                      Ce numéro est déjà utilisé par{" "}
                      <strong>{dupWarning.names.join(", ")}</strong>. Vérifiez
                      qu&apos;il ne s&apos;agit pas d&apos;un doublon.
                    </span>
                  </p>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="sup-email"
                className="text-sm font-medium text-text block mb-1.5"
              >
                E-mail
              </label>
              <input
                id="sup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@exemple.com"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div>
              <label
                htmlFor="sup-address"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Adresse
              </label>
              <input
                id="sup-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Quartier, ville"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div>
              <label
                htmlFor="sup-notes"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Notes
              </label>
              <textarea
                id="sup-notes"
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
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isEdit ? "Enregistrer" : "Ajouter"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
