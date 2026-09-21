"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Package,
  X,
  Pencil,
  Archive,
  RotateCcw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp, type NewProductInput } from "@/lib/context/app-context";
import { useOrg } from "@/lib/context/org-context";
import { formatFCFA } from "@/lib/utils";
import {
  getCategories,
  getProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
} from "@/lib/supabase/product-actions";
import { SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import type { Category } from "@/types";

type ViewProduct = {
  id: string;
  name: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  stockQuantity: number;
  minStockThreshold: number;
  categoryId: string | null;
  isActive: boolean;
  source: "supabase" | "mock";
};

export default function ProductsPage() {
  const { products: mockProducts, addProduct } = useApp();
  const { permissions } = useOrg();
  const [products, setProducts] = useState<ViewProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"supabase" | "mock">("mock");
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<ViewProduct | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [prods, cats] = await Promise.all([getProducts(), getCategories()]);
        if (cancelled) return;
        const view: ViewProduct[] = prods.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unit,
          costPrice: p.costPrice,
          salePrice: p.salePrice,
          stockQuantity: 0,
          minStockThreshold: p.minStockThreshold,
          categoryId: p.categoryId,
          isActive: p.isActive,
          source: "supabase" as const,
        }));
        setProducts(view);
        setCategories(cats);
        setSource("supabase");
      } catch (e) {
        if (cancelled) return;
        const isNotConfigured =
          e instanceof Error && e.message === SUPABASE_NOT_CONFIGURED_MESSAGE;
        if (isNotConfigured) {
          const fallback: ViewProduct[] = mockProducts.map((p) => ({
            id: p.id,
            name: p.name,
            unit: p.unit,
            costPrice: p.costPrice,
            salePrice: p.salePrice,
            stockQuantity: p.stockQuantity,
            minStockThreshold: p.minStockThreshold,
            categoryId: p.categoryId,
            isActive: true,
            source: "mock" as const,
          }));
          setProducts(fallback);
          setSource("mock");
        } else {
          setSource("supabase");
          setError(
            e instanceof Error ? e.message : "Erreur de chargement des produits"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mockProducts]);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  const activeProducts = filtered.filter((p) => p.isActive);
  const archivedProducts = filtered.filter((p) => !p.isActive);

  const handleCreate = async (input: NewProductInput) => {
    if (source === "supabase") {
      try {
        const created = await createProduct({
          name: input.name,
          unit: input.unit,
          costPrice: input.costPrice,
          salePrice: input.salePrice,
          minStockThreshold: input.minStockThreshold,
          categoryId: input.categoryId || null,
        });
        setProducts((prev) => [
          {
            id: created.id,
            name: created.name,
            unit: created.unit,
            costPrice: created.costPrice,
            salePrice: created.salePrice,
            stockQuantity: 0,
            minStockThreshold: created.minStockThreshold,
            categoryId: created.categoryId,
            isActive: created.isActive,
            source: "supabase" as const,
          },
          ...prev,
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur création");
      }
    } else {
      addProduct(input);
    }
  };

  const handleUpdate = async (input: NewProductInput) => {
    if (!editProduct || source !== "supabase") return;
    try {
      const updated = await updateProduct({
        id: editProduct.id,
        name: input.name,
        unit: input.unit,
        costPrice: input.costPrice,
        salePrice: input.salePrice,
        minStockThreshold: input.minStockThreshold,
        categoryId: input.categoryId || null,
      });
      setProducts((prev) =>
        prev.map((p) =>
          p.id === updated.id
            ? {
                ...p,
                name: updated.name,
                unit: updated.unit,
                costPrice: updated.costPrice,
                salePrice: updated.salePrice,
                minStockThreshold: updated.minStockThreshold,
                categoryId: updated.categoryId,
              }
            : p
        )
      );
      setEditProduct(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur modification");
    }
  };

  const handleArchive = async (id: string) => {
    if (source !== "supabase") return;
    try {
      await archiveProduct(id);
      setProducts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: false } : p))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur archivage");
    }
  };

  const handleRestore = async (id: string) => {
    if (source !== "supabase") return;
    try {
      await restoreProduct(id);
      setProducts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: true } : p))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur restauration");
    }
  };

  const getCategoryName = (id: string | null) => {
    if (!id) return "—";
    return categories.find((c) => c.id === id)?.name ?? "—";
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              Produits
            </h1>
          </div>
        </div>
        <Card variant="elevated">
          <div className="flex items-center justify-center py-16 gap-3 text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Chargement des produits...</span>
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
            Produits
          </h1>
          <p className="text-sm text-muted mt-1">
            {activeProducts.length} produit(s) actif(s)
            {archivedProducts.length > 0 &&
              ` · ${archivedProducts.length} archivé(s)`}
            {source === "supabase" && (
              <span className="ml-2 text-xs text-primary">(Supabase)</span>
            )}
          </p>
        </div>
        {permissions?.canManageProducts && (
          <Button
            onClick={() => {
              setEditProduct(null);
              setShowModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Ajouter un produit
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-[10px] bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button
            onClick={() => setError("")}
            className="ml-auto p-1 rounded hover:bg-error/20"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 h-9 px-3 rounded-[10px] border border-border bg-surface max-w-sm">
        <Search className="w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Rechercher un produit..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher un produit"
          className="flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <Card variant="elevated">
        <div className="overflow-x-auto">
              <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Produit
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Catégorie
                </th>
                <th className="text-left text-xs font-medium text-muted px-6 py-3">
                  Unité
                </th>
                <th className="text-right text-xs font-medium text-muted px-6 py-3">
                  Prix d&apos;achat
                </th>
                <th className="text-right text-xs font-medium text-muted px-6 py-3">
                  Prix de vente
                </th>
                <th className="text-right text-xs font-medium text-muted px-6 py-3">
                  Marge
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
              {activeProducts.map((product) => {
                const margin =
                  product.costPrice > 0
                    ? ((product.salePrice - product.costPrice) /
                        product.costPrice) *
                      100
                    : 0;

                return (
                  <tr
                    key={product.id}
                    className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-[10px] bg-lavender-soft flex items-center justify-center">
                          <Package className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-ink">
                          {product.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted">
                      {getCategoryName(product.categoryId)}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted">
                      {product.unit}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-text">
                      {formatFCFA(product.costPrice)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-ink">
                      {formatFCFA(product.salePrice)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-semibold text-success">
                        {margin.toFixed(1)} %
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant="success">Actif</Badge>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditProduct(product);
                            setShowModal(true);
                          }}
                          aria-label={`Modifier ${product.name}`}
                          className="p-1.5 rounded-[10px] text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {source === "supabase" && (
                          <button
                            onClick={() => handleArchive(product.id)}
                            aria-label={`Archiver ${product.name}`}
                            className="p-1.5 rounded-[10px] text-muted hover:text-error hover:bg-error/10 transition-colors"
                          >
                            <Archive className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {activeProducts.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-sm text-muted"
                  >
                    {query
                      ? "Aucun produit trouvé pour cette recherche."
                      : "Aucun produit. Ajoutez votre premier produit."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {archivedProducts.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted hover:text-text transition-colors">
            Produits archivés ({archivedProducts.length})
          </summary>
          <Card variant="elevated" className="mt-3">
            <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted px-6 py-3">
                      Produit
                    </th>
                    <th className="text-left text-xs font-medium text-muted px-6 py-3">
                      Unité
                    </th>
                    <th className="text-right text-xs font-medium text-muted px-6 py-3">
                      Prix d&apos;achat
                    </th>
                    <th className="text-right text-xs font-medium text-muted px-6 py-3">
                      Prix de vente
                    </th>
                    <th className="text-center text-xs font-medium text-muted px-6 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {archivedProducts.map((product) => (
                    <tr
                      key={product.id}
                      className="border-b border-border last:border-0 opacity-60"
                    >
                      <td className="px-6 py-3 text-sm text-text">
                        {product.name}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted">
                        {product.unit}
                      </td>
                      <td className="px-6 py-3 text-right text-sm text-text">
                        {formatFCFA(product.costPrice)}
                      </td>
                      <td className="px-6 py-3 text-right text-sm text-text">
                        {formatFCFA(product.salePrice)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <button
                          onClick={() => handleRestore(product.id)}
                          aria-label={`Restaurer ${product.name}`}
                          className="p-1.5 rounded-[10px] text-muted hover:text-success hover:bg-success/10 transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
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
        <ProductModal
          categories={categories}
          editProduct={editProduct}
          onClose={() => {
            setShowModal(false);
            setEditProduct(null);
          }}
          onSave={editProduct ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}

function ProductModal({
  categories,
  editProduct,
  onClose,
  onSave,
}: {
  categories: Category[];
  editProduct: ViewProduct | null;
  onClose: () => void;
  onSave: (input: NewProductInput) => void;
}) {
  const [name, setName] = useState(editProduct?.name ?? "");
  const [unit, setUnit] = useState(editProduct?.unit ?? "sac");
  const [costPrice, setCostPrice] = useState(editProduct?.costPrice ?? 0);
  const [salePrice, setSalePrice] = useState(editProduct?.salePrice ?? 0);
  const [minStockThreshold, setMinStockThreshold] = useState(
    editProduct?.minStockThreshold ?? 0
  );
  const [categoryId, setCategoryId] = useState<string>(
    editProduct?.categoryId ?? ""
  );

  const isEdit = !!editProduct;
  const canSubmit = name.trim().length > 0 && salePrice > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSave({
      name: name.trim(),
      unit,
      costPrice,
      salePrice,
      stockQuantity: 0,
      minStockThreshold,
      categoryId: categoryId || "",
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Modifier un produit" : "Ajouter un produit"}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">
              {isEdit ? "Modifier le produit" : "Ajouter un produit"}
            </h2>
            <p className="text-sm text-muted mt-1">
              {isEdit
                ? "Mettre à jour les informations du produit"
                : "Référencer un article au catalogue"}
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
              htmlFor="prod-name"
              className="text-sm font-medium text-text block mb-1.5"
            >
              Nom
            </label>
            <input
              id="prod-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Riz 10kg"
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="prod-category"
                className="text-sm font-medium text-text block"
              >
                Catégorie
              </label>
              <Link
                href="/categories"
                className="text-xs text-primary hover:underline"
              >
                Gérer les catégories
              </Link>
            </div>
            <select
              id="prod-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">Aucune catégorie</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prod-unit"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Unité
              </label>
              <input
                id="prod-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="prod-cost"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Prix d&apos;achat (FCFA)
              </label>
              <input
                id="prod-cost"
                type="number"
                min="0"
                value={costPrice === 0 ? "" : costPrice}
                onChange={(e) =>
                  setCostPrice(Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="0"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="prod-sale"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Prix de vente (FCFA)
              </label>
              <input
                id="prod-sale"
                type="number"
                min="0"
                value={salePrice === 0 ? "" : salePrice}
                onChange={(e) =>
                  setSalePrice(Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="0"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="prod-threshold"
                className="text-sm font-medium text-text block mb-1.5"
              >
                Seuil d&apos;alerte stock
              </label>
              <input
                id="prod-threshold"
                type="number"
                min="0"
                value={minStockThreshold === 0 ? "" : minStockThreshold}
                onChange={(e) =>
                  setMinStockThreshold(
                    Math.max(0, Number(e.target.value) || 0)
                  )
                }
                placeholder="0"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-muted mt-1.5">
                Stock ≤ seuil ⇒ alerte. 0 = pas d&apos;alerte
              </p>
            </div>
          </div>
        </div>

        <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
