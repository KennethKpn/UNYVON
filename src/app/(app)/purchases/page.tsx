"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Truck, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPurchases, createPurchase, receivePurchase, cancelPurchase } from "@/lib/supabase/purchase-actions";
import { getSuppliers, createSupplier } from "@/lib/supabase/supplier-actions";
import { getProducts } from "@/lib/supabase/product-actions";
import { formatFCFA } from "@/lib/utils";
import { useOrg } from "@/lib/context/org-context";
import type { Purchase, PurchaseStatus, Supplier, Product, CreatePurchaseInput } from "@/types";

const STATUS_LABELS: Record<PurchaseStatus, { label: string; variant: "default" | "success" | "error" | "warning" }> = {
  draft: { label: "Brouillon", variant: "warning" },
  received: { label: "Reçu", variant: "success" },
  cancelled: { label: "Annulé", variant: "error" },
};

export default function PurchasesPage() {
  const { permissions } = useOrg();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPurchases();
      setPurchases(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch initiale depuis server actions
  useEffect(() => { load(); }, [load]);

  const handleReceive = async (id: string) => {
    try {
      setActionLoading(id);
      await receivePurchase(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur réception");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      setActionLoading(id);
      await cancelPurchase(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur annulation");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreated = () => {
    setShowModal(false);
    load();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Achats</h1>
          <p className="text-sm text-muted mt-1">
            {loading ? "Chargement..." : `${purchases.length} achat${purchases.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {permissions?.canManageInventory && (
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nouvel achat
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-[10px] bg-danger/10 text-danger text-sm">{error}</div>
      )}

      <Card variant="elevated">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted px-6 py-3">Date</th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">Fournisseur</th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">Réf.</th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">Articles</th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">Statut</th>
                <th className="text-right text-xs font-medium text-muted px-6 py-3">Total</th>
                <th className="text-right text-xs font-medium text-muted px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Chargement des achats...
                  </td>
                </tr>
              )}
              {!loading && purchases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted">
                    Aucun achat enregistré.
                  </td>
                </tr>
              )}
              {!loading && purchases.map((purchase) => {
                const statusInfo = STATUS_LABELS[purchase.status];
                const isActing = actionLoading === purchase.id;
                return (
                  <tr
                    key={purchase.id}
                    className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-text whitespace-nowrap">
                      {new Date(purchase.purchaseDate).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-info/10 flex items-center justify-center shrink-0">
                          <Truck className="w-4 h-4 text-info" />
                        </div>
                        <span className="text-sm font-medium text-ink">
                          {purchase.supplierName}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted">
                      {purchase.reference || "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {purchase.items.map((item) => (
                          <Badge key={item.id} variant="default">
                            {item.productName} ×{item.quantity}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-semibold text-ink">
                        {formatFCFA(purchase.totalAmount)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {purchase.status === "draft" && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={isActing}
                            onClick={() => handleReceive(purchase.id)}
                          >
                            {isActing ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                            Réceptionner
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isActing}
                            onClick={() => handleCancel(purchase.id)}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <PurchaseModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          canCreateSupplier={permissions?.canManageSuppliers ?? false}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers de saisie quantité / coût
// ---------------------------------------------------------------------------

function toNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Quantité valide : entier strictement positif (rejette vide, 0, négatif, décimal). */
function isPositiveInt(v: string): boolean {
  return /^[1-9]\d*$/.test(v);
}

/** Coût valide : entier >= 0 (rejette vide et négatif ; 0 = gratuit autorisé). */
function isNonNegativeInt(v: string): boolean {
  return /^(0|[1-9]\d*)$/.test(v);
}

// ---------------------------------------------------------------------------
// Modal : Nouvel achat
// ---------------------------------------------------------------------------

function PurchaseModal({
  onClose,
  onCreated,
  canCreateSupplier,
}: {
  onClose: () => void;
  onCreated: () => void;
  canCreateSupplier: boolean;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState(""); // "" = aucun fournisseur présélectionné : la sélection est OBLIGATOIRE
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [reference, setReference] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: string; unitCost: string }[]>([]);

  useEffect(() => {
    Promise.all([getSuppliers(), getProducts()])
      .then(([s, p]) => { setSuppliers(s.filter((x) => x.isActive)); setProducts(p.filter((x) => x.isActive)); })
      .catch(() => setError("Erreur chargement données"))
      .finally(() => setLoadingData(false));
  }, []);

  const handleCreateSupplier = async () => {
    if (!supplierName.trim()) {
      setError("Le nom du fournisseur est requis.");
      return;
    }
    try {
      setSupplierSaving(true);
      setError(null);
      const created = await createSupplier({
        name: supplierName.trim(),
        phone: supplierPhone.trim(),
        email: "",
        address: "",
        notes: "",
      });
      setSuppliers((prev) => [...prev, created]);
      // Création inline réussie → le fournisseur est automatiquement sélectionné.
      setSupplierId(created.id);
      setCreatingSupplier(false);
      setSupplierName("");
      setSupplierPhone("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur création fournisseur");
    } finally {
      setSupplierSaving(false);
    }
  };

  const addLine = () => {
    // Quantité et coût initialisés vides : la valeur ne devient numérique qu'après saisie.
    setLines((prev) => [...prev, { productId: "", quantity: "", unitCost: "" }]);
  };

  const updateLine = (
    idx: number,
    patch: Partial<{ productId: string; quantity: string; unitCost: string }>
  ) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  // Quantité saisie sous forme de texte : vide = pas encore de valeur numérique.
  // Validation à la saisie : entier strictement positif (pas de 0, pas de négatif, pas de décimal).
  const updateLineQuantity = (idx: number, raw: string) => {
    if (raw === "") {
      updateLine(idx, { quantity: "" });
      return;
    }
    if (!/^(0|[1-9]\d*)$/.test(raw)) return; // rejette 0 seul, négatifs, décimales, texte
    updateLine(idx, { quantity: raw });
  };

  const updateLineUnitCost = (idx: number, raw: string) => {
    if (raw === "") {
      updateLine(idx, { unitCost: "" });
      return;
    }
    // Montant en FCFA : entier >= 0 (pas de négatif).
    if (!/^(0|[1-9]\d*)$/.test(raw)) return;
    updateLine(idx, { unitCost: raw });
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const total = lines.reduce((sum, l) => sum + toNum(l.quantity) * toNum(l.unitCost), 0);
  // Validation : fournisseur OBLIGATOIRE (pas de présélection), chaque ligne doit avoir
  // un produit, une quantité valide (> 0, non vide, non décimale) et un coût >= 0.
  const canSubmit =
    !!supplierId &&
    lines.length > 0 &&
    lines.every(
      (l) => !!l.productId && isPositiveInt(l.quantity) && isNonNegativeInt(l.unitCost)
    ) &&
    total > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (!supplierId) {
        setError("Veuillez sélectionner un fournisseur.");
      }
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const input: CreatePurchaseInput = {
        supplierId,
        reference,
        purchaseDate,
        notes,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: toNum(l.quantity),
          unitCost: toNum(l.unitCost),
        })),
      };
      await createPurchase(input);
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur création");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Nouvel achat"
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">Nouvel achat</h2>
            <p className="text-sm text-muted mt-1">Enregistrer une livraison fournisseur</p>
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
          {loadingData && (
            <div className="text-center py-6 text-sm text-muted">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Chargement...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-[10px] bg-danger/10 text-danger text-sm">{error}</div>
          )}

          {!loadingData && (
            <>
              {/* Fournisseur */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="pur-supplier" className="text-sm font-medium text-text block">
                    Fournisseur *
                  </label>
                  {canCreateSupplier && !creatingSupplier && (
                    <button
                      type="button"
                      onClick={() => setCreatingSupplier(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Nouveau fournisseur
                    </button>
                  )}
                </div>
                {creatingSupplier ? (
                  <div className="space-y-2 p-3 rounded-[10px] border border-border bg-background">
                    <input
                      type="text"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Nom du fournisseur *"
                      aria-label="Nom du nouveau fournisseur"
                      className="w-full h-10 px-3 rounded-[8px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <input
                      type="text"
                      value={supplierPhone}
                      onChange={(e) => setSupplierPhone(e.target.value)}
                      placeholder="Téléphone"
                      aria-label="Téléphone du nouveau fournisseur"
                      className="w-full h-10 px-3 rounded-[8px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleCreateSupplier}
                        disabled={supplierSaving || !supplierName.trim()}
                      >
                        {supplierSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Créer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreatingSupplier(false);
                          setSupplierName("");
                          setSupplierPhone("");
                        }}
                        disabled={supplierSaving}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <select
                      id="pur-supplier"
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      required
                      aria-describedby="pur-supplier-hint"
                      className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      {/* Aucune présélection : l'utilisateur DOIT choisir un fournisseur. */}
                      <option value="">Sélectionner un fournisseur *</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <p id="pur-supplier-hint" className="text-xs text-muted mt-1">
                      Sélection obligatoire pour enregistrer l&apos;achat.
                    </p>
                  </>
                )}
              </div>

              {/* Réf + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pur-ref" className="text-sm font-medium text-text block mb-1.5">Référence</label>
                  <input
                    id="pur-ref"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="ex: BCA-2026-004"
                    className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div>
                  <label htmlFor="pur-date" className="text-sm font-medium text-text block mb-1.5">Date</label>
                  <input
                    id="pur-date"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              {/* Lignes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-text">Lignes d&apos;achat</label>
                  <Button size="sm" variant="outline" onClick={addLine}>
                    <Plus className="w-4 h-4" /> Ajouter
                  </Button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-[10px] border border-border">
                      <select
                        value={line.productId}
                        onChange={(e) => updateLine(idx, { productId: e.target.value })}
                        className="flex-1 h-9 px-2 rounded-[8px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Produit</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => updateLineQuantity(idx, e.target.value)}
                        placeholder="Ex. 5"
                        aria-label="Quantité"
                        className="w-full sm:w-20 h-9 px-2 rounded-[8px] border border-border text-sm text-center text-ink focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={line.unitCost}
                        onChange={(e) => updateLineUnitCost(idx, e.target.value)}
                        placeholder="Ex. 15000"
                        aria-label="Coût unitaire"
                        className="w-full sm:w-28 h-9 px-2 rounded-[8px] border border-border text-sm text-right text-ink focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <div className="flex items-center justify-between sm:justify-start sm:gap-2">
                        <span className="text-xs text-muted whitespace-nowrap">
                          {formatFCFA(Number(line.quantity) * Number(line.unitCost))}
                        </span>
                        <button
                          onClick={() => removeLine(idx)}
                          aria-label="Supprimer la ligne"
                          className="p-1 rounded text-muted hover:text-danger transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {lines.length === 0 && (
                    <p className="text-xs text-muted text-center py-3">Aucune ligne. Cliquez &quot;Ajouter&quot;.</p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="pur-notes" className="text-sm font-medium text-text block mb-1.5">Notes</label>
                <textarea
                  id="pur-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes optionnelles..."
                  className="w-full px-3 py-2 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>

              {/* Total */}
              <div className="flex items-center justify-between p-3 rounded-[10px] bg-background">
                <span className="text-sm text-muted">Total</span>
                <span className="font-display font-semibold text-lg text-ink">
                  {formatFCFA(total)}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving || loadingData}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Enregistrer
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
