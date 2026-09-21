"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X, Loader2, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getExpenses, createExpense, updateExpense, deleteExpense } from "@/lib/supabase/expense-actions";
import { formatFCFA } from "@/lib/utils";
import { useOrg } from "@/lib/context/org-context";
import type { DatabaseExpense, ExpenseCategory, DatabasePaymentMethod } from "@/types";

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Loyer",
  transport: "Transport",
  personnel: "Personnel",
  electricity: "Électricité",
  communication: "Communication",
  supplies: "Fournitures",
  maintenance: "Maintenance",
  other: "Autre",
};

const PAYMENT_LABELS: Record<DatabasePaymentMethod, string> = {
  cash: "Espèces",
  mobile_money: "Mobile Money",
  bank_transfer: "Virement",
  other: "Autre",
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  rent: "bg-primary/10 text-primary",
  transport: "bg-info/10 text-info",
  personnel: "bg-warning/10 text-warning",
  electricity: "bg-success/10 text-success",
  communication: "bg-lavender-soft text-primary",
  supplies: "bg-background text-muted",
  maintenance: "bg-info/10 text-info",
  other: "bg-background text-muted",
};

export default function ExpensesPage() {
  const { permissions } = useOrg();
  const [expenses, setExpenses] = useState<DatabaseExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editExpense, setEditExpense] = useState<DatabaseExpense | null>(null);
  const [filterCategory, setFilterCategory] = useState<ExpenseCategory | "all">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getExpenses();
      setExpenses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial des dépenses
    void load();
  }, [load]);

  const filtered = expenses.filter((e) => {
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalFiltered = filtered.reduce((sum, e) => sum + Number(e.amount), 0);

  const handleCreate = async (input: {
    category: ExpenseCategory;
    description: string;
    amount: number;
    expense_date?: string;
    payment_method: DatabasePaymentMethod;
    reference?: string;
    notes?: string;
  }) => {
    try {
      await createExpense(input);
      setShowCreateModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de création");
    }
  };

  const handleUpdate = async (input: {
    id: string;
    category?: ExpenseCategory;
    description?: string;
    amount?: number;
    expense_date?: string;
    payment_method?: DatabasePaymentMethod;
    reference?: string;
    notes?: string;
  }) => {
    try {
      await updateExpense(input);
      setEditExpense(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de modification");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette dépense ?")) return;
    try {
      await deleteExpense(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de suppression");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Dépenses</h1>
          <p className="text-sm text-muted mt-1">
            Total : {formatFCFA(totalFiltered)}
            {filterCategory !== "all" && (
              <span className="ml-2">({CATEGORY_LABELS[filterCategory]})</span>
            )}
          </p>
        </div>
        {permissions?.canManageOrganization && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4" />
            Nouvelle dépense
          </Button>
        )}
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher..."
          className="h-10 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary flex-1"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as ExpenseCategory | "all")}
          className="h-10 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="all">Toutes les catégories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] bg-error/10 border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      <Card variant="elevated">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted" />
            </div>
          ) : (
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted px-6 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted px-6 py-3">Catégorie</th>
                  <th className="text-left text-xs font-medium text-muted px-6 py-3">Description</th>
                  <th className="text-left text-xs font-medium text-muted px-6 py-3">Paiement</th>
                  <th className="text-right text-xs font-medium text-muted px-6 py-3">Montant</th>
                  <th className="text-right text-xs font-medium text-muted px-6 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((expense) => (
                  <tr
                    key={expense.id}
                    className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-text">
                      {new Date(expense.expense_date).toLocaleDateString("fr-FF", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={CATEGORY_COLORS[expense.category] || "bg-background text-muted"}>
                        {CATEGORY_LABELS[expense.category]}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-text">{expense.description}</td>
                    <td className="px-6 py-4 text-sm text-muted">
                      {PAYMENT_LABELS[expense.payment_method]}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-semibold text-error">
                        -{formatFCFA(Number(expense.amount))}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditExpense(expense)}
                          className="p-1.5 rounded-[8px] text-muted hover:text-text hover:bg-background transition-colors"
                          aria-label="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(expense.id)}
                          className="p-1.5 rounded-[8px] text-muted hover:text-error hover:bg-error/10 transition-colors"
                          aria-label="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-muted">
                      {search || filterCategory !== "all"
                        ? "Aucune dépense ne correspond aux filtres."
                        : "Aucune dépense enregistrée."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {showCreateModal && (
        <ExpenseModal
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
        />
      )}

      {editExpense && (
        <ExpenseModal
          expense={editExpense}
          onClose={() => setEditExpense(null)}
          onSave={(input) => handleUpdate({ id: editExpense.id, ...input })}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  expense,
  onClose,
  onSave,
}: {
  expense?: DatabaseExpense;
  onClose: () => void;
  onSave: (input: {
    category: ExpenseCategory;
    description: string;
    amount: number;
    expense_date?: string;
    payment_method: DatabasePaymentMethod;
    reference?: string;
    notes?: string;
  }) => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "rent");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? Number(expense.amount) : 0);
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<DatabasePaymentMethod>(expense?.payment_method ?? "cash");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [saving, setSaving] = useState(false);

  const canSubmit = description.trim().length > 0 && amount > 0;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await onSave({
        category,
        description: description.trim(),
        amount,
        expense_date: expenseDate,
        payment_method: paymentMethod,
        reference: reference.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={expense ? "Modifier la dépense" : "Nouvelle dépense"}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-surface rounded-card border border-border shadow-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="shrink-0 p-6 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="font-display font-semibold text-lg text-ink">
              {expense ? "Modifier la dépense" : "Nouvelle dépense"}
            </h2>
            <p className="text-sm text-muted mt-1">Enregistrer une sortie de trésorerie</p>
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
            <label htmlFor="exp-category" className="text-sm font-medium text-text block mb-1.5">
              Catégorie
            </label>
            <select
              id="exp-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="exp-desc" className="text-sm font-medium text-text block mb-1.5">
              Description
            </label>
            <input
              id="exp-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex. Loyer entrepôt octobre"
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="exp-amount" className="text-sm font-medium text-text block mb-1.5">
                Montant (FCFA)
              </label>
              <input
                id="exp-amount"
                type="number"
                min="1"
                value={amount === 0 ? "" : amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                placeholder="0"
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="exp-date" className="text-sm font-medium text-text block mb-1.5">
                Date
              </label>
              <input
                id="exp-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label htmlFor="exp-payment" className="text-sm font-medium text-text block mb-1.5">
              Méthode de paiement
            </label>
            <select
              id="exp-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as DatabasePaymentMethod)}
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="exp-ref" className="text-sm font-medium text-text block mb-1.5">
              Référence <span className="text-muted">(optionnel)</span>
            </label>
            <input
              id="exp-ref"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="N° facture, reçu..."
              className="w-full h-11 px-4 rounded-[10px] border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <div className="shrink-0 p-6 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : expense ? (
              "Modifier"
            ) : (
              "Enregistrer"
            )}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
