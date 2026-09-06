"use client";

import { useEffect, useState } from "react";
import { Plus, Tags, X, Pencil, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/context/org-context";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/supabase/product-actions";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const { permissions } = useOrg();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getCategories();
        if (!cancelled) setCategories(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (name: string) => {
    try {
      const created = await createCategory({ name });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      throw e;
    }
  };

  const handleUpdate = async (name: string) => {
    if (!editCategory) return;
    try {
      const updated = await updateCategory({ id: editCategory.id, name });
      setCategories((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      throw e;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteCategory(deleteTarget.id);
      setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de suppression");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Catégories</h1>
          <p className="text-sm text-muted mt-1">
            {categories.length} catégorie{categories.length > 1 ? "s" : ""} · structurez votre catalogue
          </p>
        </div>
        {permissions?.canManageCategories && (
          <Button
            onClick={() => {
              setEditCategory(null);
              setShowModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Nouvelle catégorie
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-error bg-error/5 border border-error/20 rounded-[10px] px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            Aucune catégorie. Créez votre première catégorie pour ranger vos produits.
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => (
            <Card key={category.id} variant="elevated" className="hover:shadow-md transition-shadow">
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-[10px] bg-lavender-soft flex items-center justify-center shrink-0">
                      <Tags className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display font-semibold text-sm text-ink truncate">
                        {category.name}
                      </h3>
                      <p className="text-xs text-muted mt-0.5">
                        Créée le{" "}
                        {new Date(category.createdAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  {permissions?.canManageCategories && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditCategory(category);
                          setShowModal(true);
                        }}
                        aria-label={`Renommer ${category.name}`}
                        className="p-1.5 rounded-[10px] text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(category)}
                        aria-label={`Supprimer ${category.name}`}
                        className="p-1.5 rounded-[10px] text-muted hover:text-error hover:bg-error/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <CategoryModal
          category={editCategory}
          onClose={() => {
            setShowModal(false);
            setEditCategory(null);
          }}
          onSave={async (name) => {
            if (editCategory) {
              await handleUpdate(name);
            } else {
              await handleCreate(name);
            }
          }}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Supprimer une catégorie"
        >
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-sm">
              <div className="p-6">
                <h2 className="font-display font-semibold text-lg text-ink">
                  Supprimer la catégorie ?
                </h2>
                <p className="text-sm text-muted mt-1">
                  « {deleteTarget.name} » sera supprimée. Les produits qui utilisent cette catégorie la perdront (sans être supprimés).
                </p>
              </div>
              <div className="p-6 pt-0 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                  Annuler
                </Button>
                <Button
                  variant="outline"
                  className="bg-error/10 text-error border-error/20 hover:bg-error/15"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Supprimer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryModal({
  category,
  onClose,
  onSave,
}: {
  category: Category | null;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'enregistrement");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={category ? "Renommer la catégorie" : "Nouvelle catégorie"}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-md">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">
              {category ? "Renommer la catégorie" : "Nouvelle catégorie"}
            </h2>
            <p className="text-sm text-muted mt-1">
              {category
                ? "Mettre à jour le nom de la catégorie"
                : "Ranger vos produits par famille"}
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

        <div className="p-6">
          <label htmlFor="cat-name" className="text-sm font-medium text-text block mb-1.5">
            Nom *
          </label>
          <input
            id="cat-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Ex. Céréales, Boissons, Produits laitiers"
            className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {error && (
            <p className="mt-2 text-xs text-error flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {category ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}