"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  ShoppingCart,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  CreditCard,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getSales,
  createSale,
  confirmSale,
  cancelSale,
} from "@/lib/supabase/sales-actions";
import {
  createPayment,
} from "@/lib/supabase/payment-actions";
import { getProducts } from "@/lib/supabase/product-actions";
import { getCustomers } from "@/lib/supabase/customer-actions";
import { getOrgStocks } from "@/lib/supabase/inventory-actions";
import { formatFCFA } from "@/lib/utils";
import { useOrg } from "@/lib/context/org-context";
import type {
  SaleWithItems,
  SaleStatus,
  Product,
  Customer,
  ProductStock,
  CreateSaleInput,
  DatabasePaymentMethod,
} from "@/types";

const STATUS_LABELS: Record<
  SaleStatus,
  { label: string; variant: "default" | "success" | "error" | "warning" }
> = {
  draft: { label: "Brouillon", variant: "warning" },
  confirmed: { label: "Confirmée", variant: "success" },
  cancelled: { label: "Annulée", variant: "error" },
};

const PAYMENT_METHODS: { value: DatabasePaymentMethod; label: string }[] = [
  { value: "cash", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "bank_transfer", label: "Virement bancaire" },
  { value: "other", label: "Autre" },
];

interface CartItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCostSnapshot: number;
  stock: number;
}

export default function SalesPage() {
  const { permissions } = useOrg();
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stocks, setStocks] = useState<ProductStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewSale, setShowNewSale] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  // Payment modal state
  const [payForSale, setPayForSale] = useState<SaleWithItems | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<DatabasePaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Initial payment state (during sale creation)
  const [initialPaymentAmount, setInitialPaymentAmount] = useState("");
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<DatabasePaymentMethod>("cash");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, p, c, st] = await Promise.all([
        getSales(),
        getProducts(),
        getCustomers(),
        getOrgStocks(),
      ]);
      setSales(s);
      setProducts(p);
      setCustomers(c);
      setStocks(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch initiale depuis server actions
  useEffect(() => { load(); }, [load]);

  const getStock = (productId: string): number => {
    return stocks.find((st) => st.productId === productId)?.stock ?? 0;
  };

  const filteredProducts = products.filter(
    (p) =>
      p.isActive &&
      p.name.toLowerCase().includes(productSearch.toLowerCase()) &&
      !cart.some((c) => c.productId === p.id)
  );

  const filteredSales = sales.filter(
    (s) =>
      (s.customerName ?? "Comptoir")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      s.reference?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const cartCost = cart.reduce((sum, item) => sum + item.quantity * item.unitCostSnapshot, 0);

  const addToCart = (product: Product) => {
    const stock = getStock(product.id);
    if (stock <= 0) return;
    setCart((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: 1,
        unitPrice: product.salePrice,
        unitCostSnapshot: product.costPrice,
        stock,
      },
    ]);
  };

  const updateCartQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((i) => {
        if (i.productId !== productId) return i;
        const clamped = Math.min(qty, i.stock);
        return { ...i, quantity: clamped };
      })
    );
  };

  const updateCartPrice = (productId: string, price: number) => {
    setCart((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, unitPrice: price } : i))
    );
  };

  const handleCreateSale = async (status: "draft" | "confirmed") => {
    if (cart.length === 0) return;
    setActionLoading("create");
    try {
      const input: CreateSaleInput = {
        customerId: selectedCustomerId,
        items: cart.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          unitCostSnapshot: i.unitCostSnapshot,
        })),
      };
      const sale = await createSale(input);

      if (status === "confirmed") {
        try {
          await confirmSale(sale.id);

          // Record initial payment if specified
          const initPay = parseFloat(initialPaymentAmount) || 0;
          if (initPay > 0) {
            await createPayment({
              sale_id: sale.id,
              amount: initPay,
              payment_method: initialPaymentMethod,
            });
          }
        } catch (confirmErr) {
          // Clean up orphan draft on confirm failure
          try { await cancelSale(sale.id); } catch { /* best effort */ }
          throw confirmErr;
        }
      }

      setShowNewSale(false);
      setCart([]);
      setSelectedCustomerId(null);
      setInitialPaymentAmount("");
      setInitialPaymentMethod("cash");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur création vente";
      // Translate UUID-based error to user-friendly message
      const friendly = msg.includes("Stock insuffisant")
        ? "Stock insuffisant pour un ou plusieurs produits. Veuillez réduire les quantités."
        : msg;
      setError(friendly);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirm = async (saleId: string) => {
    setActionLoading(saleId);
    try {
      await confirmSale(saleId);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur confirmation";
      const friendly = msg.includes("Stock insuffisant")
        ? "Stock insuffisant pour un ou plusieurs produits."
        : msg;
      setError(friendly);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (saleId: string) => {
    setActionLoading(saleId);
    try {
      await cancelSale(saleId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur annulation");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRecordPayment = async () => {
    if (!payForSale || !paymentAmount) return;
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      setError("Montant invalide");
      return;
    }
    setPaymentLoading(true);
    try {
      await createPayment({
        sale_id: payForSale.id,
        amount: amt,
        payment_method: paymentMethod,
        reference: paymentReference || undefined,
      });
      setPayForSale(null);
      setPaymentAmount("");
      setPaymentReference("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur paiement");
    } finally {
      setPaymentLoading(false);
    }
  };

  const totalVentes = sales
    .filter((s) => s.status === "confirmed")
    .reduce((sum, s) => sum + s.total_amount, 0);

  const totalMarge = sales
    .filter((s) => s.status === "confirmed")
    .reduce(
      (sum, s) =>
        sum + s.items.reduce((isum, i) => isum + (i.unit_price - i.unit_cost_snapshot) * i.quantity, 0),
      0
    );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-bold text-ink">Ventes</h1>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Ventes</h1>
          <p className="text-sm text-muted mt-1">
            {sales.length} vente{sales.length !== 1 ? "s" : ""} au total
          </p>
        </div>
        {permissions?.canCreateSale && (
          <Button onClick={() => setShowNewSale(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle vente
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-error/30 bg-error/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertTriangle className="h-5 w-5 text-error" />
            <p className="text-sm text-error">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Total ventes</p>
            <p className="text-2xl font-bold text-ink">{formatFCFA(totalVentes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Marge brute</p>
            <p className="text-2xl font-bold text-success">{formatFCFA(totalMarge)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Brouillons</p>
            <p className="text-2xl font-bold text-warning">
              {sales.filter((s) => s.status === "draft").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">En attente</p>
            <p className="text-2xl font-bold text-error">
              {sales.filter((s) => s.status === "confirmed").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Rechercher une vente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </CardContent>
      </Card>

      {filteredSales.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart className="h-12 w-12 text-muted mb-4" />
            <p className="text-lg font-medium text-ink">Aucune vente</p>
            <p className="text-sm text-muted mt-1">Créez votre première vente pour commencer</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Client</th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Articles</th>
                  <th className="text-right text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Total</th>
                  <th className="text-right text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Marge</th>
                  <th className="text-center text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-center text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => {
                  const status = STATUS_LABELS[sale.status];
                  const margin = sale.items.reduce(
                    (sum, i) => sum + (i.unit_price - i.unit_cost_snapshot) * i.quantity,
                    0
                  );
                  return (
                    <tr key={sale.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 text-sm text-ink">
                        {new Date(sale.created_at).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink">
                        {sale.customerName ?? <span className="text-muted italic">Comptoir</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {sale.items.map((item) => (
                            <Badge key={item.id} variant="default" className="text-xs">
                              {item.productName} x{item.quantity}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-ink">
                        {formatFCFA(sale.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={margin >= 0 ? "text-success" : "text-error"}>
                          {formatFCFA(margin)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {sale.status === "draft" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Confirmer la vente"
                                onClick={() => handleConfirm(sale.id)}
                                disabled={actionLoading === sale.id}
                              >
                                {actionLoading === sale.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 text-success" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Annuler la vente"
                                onClick={() => handleCancel(sale.id)}
                                disabled={actionLoading === sale.id}
                              >
                                <XCircle className="h-4 w-4 text-error" />
                              </Button>
                            </>
                          )}
                          {sale.status === "confirmed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Enregistrer un paiement"
                              onClick={() => setPayForSale(sale)}
                            >
                              <CreditCard className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* New Sale Modal */}
      {showNewSale && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Nouvelle vente"
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
              <div className="shrink-0 p-6 border-b border-border flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-ink">Nouvelle vente</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Fermer"
                  onClick={() => {
                    setShowNewSale(false);
                    setCart([]);
                    setSelectedCustomerId(null);
                    setInitialPaymentAmount("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-ink">Client (optionnel)</label>
                  <select
                    value={selectedCustomerId ?? ""}
                    onChange={(e) => {
                      setSelectedCustomerId(e.target.value || null);
                      setCart([]);
                    }}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg bg-background text-ink"
                  >
                    <option value="">Client comptoir</option>
                    {customers.filter((c) => c.isActive).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-ink">Ajouter un produit</label>
                  <input
                    type="text"
                    placeholder="Rechercher un produit..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg bg-background text-ink placeholder:text-muted"
                  />
                  {productSearch && filteredProducts.length > 0 && (
                    <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto">
                      {filteredProducts.map((p) => {
                        const stock = getStock(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => { addToCart(p); setProductSearch(""); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between"
                          >
                            <div>
                              <p className="text-sm font-medium text-ink">{p.name}</p>
                              <p className="text-xs text-muted">{formatFCFA(p.salePrice)} / {p.unit}</p>
                            </div>
                            <Badge variant={stock > 0 ? "default" : "error"} className="text-xs">
                              Stock: {stock}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full min-w-[600px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left text-xs font-medium text-muted px-3 py-2">Produit</th>
                          <th className="text-right text-xs font-medium text-muted px-3 py-2">Qté</th>
                          <th className="text-right text-xs font-medium text-muted px-3 py-2">Prix unit.</th>
                          <th className="text-right text-xs font-medium text-muted px-3 py-2">Total</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cart.map((item) => (
                          <tr key={item.productId} className="border-b border-border last:border-0">
                            <td className="px-3 py-2">
                              <p className="text-sm font-medium text-ink">{item.productName}</p>
                              <p className={`text-xs ${item.quantity >= item.stock ? "text-error font-medium" : "text-muted"}`}>
                                Stock: {item.stock} {item.unit}
                                {item.quantity >= item.stock && " — max"}
                              </p>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={1}
                                max={item.stock}
                                value={item.quantity}
                                onChange={(e) => updateCartQuantity(item.productId, parseInt(e.target.value) || 0)}
                                className={`w-16 text-right px-2 py-1 border rounded text-sm ${
                                  item.quantity >= item.stock
                                    ? "border-amber-400 bg-amber-50 text-amber-800"
                                    : "border-border"
                                }`}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                value={item.unitPrice}
                                onChange={(e) => updateCartPrice(item.productId, parseFloat(e.target.value) || 0)}
                                className="w-24 text-right px-2 py-1 border border-border rounded text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-ink">
                              {formatFCFA(item.quantity * item.unitPrice)}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => updateCartQuantity(item.productId, 0)} className="text-muted hover:text-error">
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {cart.length > 0 && (
                  <div className="border-t border-border pt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Sous-total</span>
                      <span className="font-medium text-ink">{formatFCFA(cartTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Marge estimée</span>
                      <span className="font-medium text-success">{formatFCFA(cartTotal - cartCost)}</span>
                    </div>
                  </div>
                )}

                {/* Initial payment section */}
                {cart.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <p className="text-sm font-medium text-ink mb-2">Paiement initial (optionnel)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <input
                        type="number"
                        min={0}
                        max={cartTotal}
                        placeholder="Montant"
                        value={initialPaymentAmount}
                        onChange={(e) => setInitialPaymentAmount(e.target.value)}
                        className="px-3 py-2 border border-border rounded-lg bg-background text-ink"
                      />
                      <select
                        value={initialPaymentMethod}
                        onChange={(e) => setInitialPaymentMethod(e.target.value as DatabasePaymentMethod)}
                        className="px-3 py-2 border border-border rounded-lg bg-background text-ink"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <div className="flex items-center text-sm text-muted">
                        {initialPaymentAmount && parseFloat(initialPaymentAmount) > 0 && (
                          <span>
                            Reste: {formatFCFA(cartTotal - (parseFloat(initialPaymentAmount) || 0))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="shrink-0 flex gap-3 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => handleCreateSale("draft")}
                    disabled={cart.length === 0 || actionLoading === "create"}
                    className="flex-1"
                  >
                    {actionLoading === "create" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Enregistrer brouillon
                  </Button>
                  <Button
                    onClick={() => handleCreateSale("confirmed")}
                    disabled={cart.length === 0 || actionLoading === "create"}
                    className="flex-1"
                  >
                    {actionLoading === "create" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Confirmer la vente
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payForSale && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Enregistrer un paiement"
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="shrink-0 p-6 border-b border-border flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-ink">Enregistrer un paiement</h2>
                <Button variant="ghost" size="sm" onClick={() => setPayForSale(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-sm text-muted">Vente</p>
                  <p className="font-medium text-ink">
                    {payForSale.reference ?? payForSale.id.slice(0, 8)}
                  </p>
                  <p className="text-sm text-muted mt-1">Total: {formatFCFA(payForSale.total_amount)}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-ink">Montant</label>
                  <input
                    type="number"
                    min={0}
                    max={payForSale.total_amount}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Montant du paiement"
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg bg-background text-ink"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-ink">Méthode</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as DatabasePaymentMethod)}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg bg-background text-ink"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-ink">Référence (optionnel)</label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Numéro de transaction"
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg bg-background text-ink"
                  />
                </div>

                <div className="shrink-0 pt-2">
                  <Button
                    onClick={handleRecordPayment}
                    disabled={!paymentAmount || paymentLoading}
                    className="w-full"
                  >
                    {paymentLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Enregistrer le paiement
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
