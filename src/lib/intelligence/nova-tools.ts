// ============================================================================
// NOVA business tools — read-only, organization-scoped data for Gemini
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { GeminiFunctionTool } from "./gemini-client";

const daysSchema = z.object({
  period_days: z.number().int().min(1).max(365).default(30),
});

const nameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const NOVA_TOOLS: GeminiFunctionTool[] = [
  {
    type: "function",
    name: "get_business_snapshot",
    description:
      "Retourne une vue d'ensemble factuelle de l'entreprise, de son activité et de ses principaux indicateurs. Utilise cet outil pour comprendre la situation générale du gérant.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_sales_analysis",
    description:
      "Analyse les ventes confirmées sur une période donnée: chiffre d'affaires, ticket moyen, meilleurs produits et meilleurs clients.",
    parameters: {
      type: "object",
      properties: {
        period_days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "Nombre de jours à analyser. Défaut: 30.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_inventory_analysis",
    description:
      "Analyse le stock réel à partir des mouvements et des ventes récentes, avec seuils d'alerte, rythme de consommation et risque de rupture.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_receivables",
    description:
      "Analyse les créances clients: montant total dû, principaux débiteurs et ventilation des soldes.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_purchases_analysis",
    description:
      "Analyse les achats reçus sur une période: montant, fournisseurs et évolutions récentes des coûts d'achat.",
    parameters: {
      type: "object",
      properties: {
        period_days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "Nombre de jours à analyser. Défaut: 90.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_expenses_analysis",
    description:
      "Analyse les dépenses sur une période avec total, moyenne et principales catégories.",
    parameters: {
      type: "object",
      properties: {
        period_days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "Nombre de jours à analyser. Défaut: 30.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_product_detail",
    description:
      "Recherche un produit par son nom et retourne ses caractéristiques, son stock actuel, ses ventes récentes et son rythme de consommation.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nom ou partie du nom du produit.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_customer_detail",
    description:
      "Recherche un client par son nom et retourne son historique de ventes, paiements et créance restante.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nom ou partie du nom du client.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

type ToolName = (typeof NOVA_TOOLS)[number]["name"];

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function monthKey(date: string): string {
  return String(date).slice(0, 7);
}

function computeStock(
  movements: Array<{
    product_id: string;
    movement_type: string;
    quantity: number;
  }>
): Map<string, number> {
  const stock = new Map<string, number>();

  for (const movement of movements) {
    const current = stock.get(movement.product_id) ?? 0;
    const inbound =
      movement.movement_type === "opening" ||
      movement.movement_type === "purchase_receipt" ||
      movement.movement_type === "adjustment_in";
    stock.set(
      movement.product_id,
      current + (inbound ? Number(movement.quantity) : -Number(movement.quantity))
    );
  }

  return stock;
}

async function getConfirmedSales(
  supabase: SupabaseClient,
  orgId: string,
  since?: string
) {
  let query = supabase
    .from("sales")
    .select("id, customer_id, total_amount, sale_date, status")
    .eq("organization_id", orgId)
    .eq("status", "confirmed")
    .order("sale_date", { ascending: false })
    .limit(10000);

  if (since) query = query.gte("sale_date", since);

  const { data, error } = await query;
  if (error) throw new Error(`Impossible de lire les ventes: ${error.message}`);
  return data ?? [];
}

export async function executeNovaTool(
  supabase: SupabaseClient,
  orgId: string,
  role: string,
  organization: {
    name: string;
    sector: string;
    currency: string;
    activity_description: string;
  },
  name: ToolName,
  rawArgs: unknown
): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_business_snapshot": {
      const [
        orgs,
        products,
        customers,
        suppliers,
        sales,
        payments,
        expenses,
        purchases,
      ] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("id", orgId),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
        getConfirmedSales(supabase, orgId, dateDaysAgo(62)),
        supabase.from("payments").select("amount, payment_date").eq("organization_id", orgId).gte("payment_date", dateDaysAgo(62)).limit(10000),
        supabase.from("expenses").select("amount, expense_date").eq("organization_id", orgId).gte("expense_date", dateDaysAgo(62)).limit(10000),
        supabase.from("purchases").select("total_amount, purchase_date, status").eq("organization_id", orgId).eq("status", "received").gte("purchase_date", dateDaysAgo(62)).limit(10000),
      ]);

      for (const result of [orgs, products, customers, suppliers, payments, expenses, purchases]) {
        if (result.error) throw new Error(`Lecture impossible: ${result.error.message}`);
      }

      const currentMonth = monthKey(new Date().toISOString());
      const previousDate = new Date();
      previousDate.setMonth(previousDate.getMonth() - 1);
      const previousMonth = monthKey(previousDate.toISOString());

      const revenueByMonth = new Map<string, number>();
      for (const sale of sales) {
        const key = monthKey(String(sale.sale_date));
        revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + Number(sale.total_amount));
      }

      const receiptsByMonth = new Map<string, number>();
      for (const payment of payments.data ?? []) {
        const key = monthKey(String(payment.payment_date));
        receiptsByMonth.set(key, (receiptsByMonth.get(key) ?? 0) + Number(payment.amount));
      }

      const expensesByMonth = new Map<string, number>();
      for (const expense of expenses.data ?? []) {
        const key = monthKey(String(expense.expense_date));
        expensesByMonth.set(key, (expensesByMonth.get(key) ?? 0) + Number(expense.amount));
      }

      return {
        organization: {
          name: organization.name,
          sector: organization.sector,
          activity: organization.activity_description || null,
          currency: organization.currency,
          user_role: role,
        },
        counts: {
          products: products.count ?? 0,
          customers: customers.count ?? 0,
          suppliers: suppliers.count ?? 0,
        },
        current_month: {
          month: currentMonth,
          revenue: revenueByMonth.get(currentMonth) ?? 0,
          receipts: receiptsByMonth.get(currentMonth) ?? 0,
          expenses: expensesByMonth.get(currentMonth) ?? 0,
        },
        previous_month: {
          month: previousMonth,
          revenue: revenueByMonth.get(previousMonth) ?? 0,
          receipts: receiptsByMonth.get(previousMonth) ?? 0,
          expenses: expensesByMonth.get(previousMonth) ?? 0,
        },
      };
    }

    case "get_sales_analysis": {
      const parsed = daysSchema.parse(
        rawArgs && typeof rawArgs === "object" ? rawArgs : {}
      );
      const sales = await getConfirmedSales(
        supabase,
        orgId,
        dateDaysAgo(parsed.period_days ?? 30)
      );

      if (sales.length === 0) {
        return { period_days: parsed.period_days ?? 30, sale_count: 0, revenue: 0, average_ticket: 0, top_products: [], top_customers: [] };
      }

      const saleIds = sales.map((sale) => String(sale.id));
      const customerIds = [...new Set(sales.map((sale) => sale.customer_id).filter(Boolean).map(String))];

      const [itemsResult, customersResult] = await Promise.all([
        supabase
          .from("sale_items")
          .select("sale_id, product_id, quantity, unit_price, unit_cost_snapshot")
          .in("sale_id", saleIds)
          .limit(30000),
        customerIds.length
          ? supabase.from("customers").select("id, name").in("id", customerIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (itemsResult.error) throw new Error(`Impossible de lire les lignes de vente: ${itemsResult.error.message}`);
      if (customersResult.error) throw new Error(`Impossible de lire les clients: ${customersResult.error.message}`);

      const productIds = [...new Set((itemsResult.data ?? []).map((item) => String(item.product_id)))];
      const productsResult = productIds.length
        ? await supabase.from("products").select("id, name, unit").in("id", productIds)
        : { data: [], error: null };
      if (productsResult.error) throw new Error(`Impossible de lire les produits: ${productsResult.error.message}`);

      const productNames = new Map((productsResult.data ?? []).map((product) => [String(product.id), { name: product.name, unit: product.unit }]));
      const customerNames = new Map((customersResult.data ?? []).map((customer: { id: string; name: string }) => [String(customer.id), customer.name]));

      const byProduct = new Map<string, { quantity: number; revenue: number }>();
      for (const item of itemsResult.data ?? []) {
        const key = String(item.product_id);
        const current = byProduct.get(key) ?? { quantity: 0, revenue: 0 };
        current.quantity += Number(item.quantity);
        current.revenue += Number(item.quantity) * Number(item.unit_price);
        byProduct.set(key, current);
      }

      const byCustomer = new Map<string, number>();
      for (const sale of sales) {
        if (!sale.customer_id) continue;
        const key = String(sale.customer_id);
        byCustomer.set(key, (byCustomer.get(key) ?? 0) + Number(sale.total_amount));
      }

      return {
        period_days: parsed.period_days ?? 30,
        sale_count: sales.length,
        revenue: sales.reduce((sum, sale) => sum + Number(sale.total_amount), 0),
        average_ticket:
          sales.length > 0
            ? sales.reduce((sum, sale) => sum + Number(sale.total_amount), 0) / sales.length
            : 0,
        top_products: [...byProduct.entries()]
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 10)
          .map(([id, value]) => ({
            product: productNames.get(id)?.name ?? "Produit",
            unit: productNames.get(id)?.unit ?? null,
            quantity: value.quantity,
            revenue: value.revenue,
          })),
        top_customers: [...byCustomer.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id, revenue]) => ({
            customer: customerNames.get(id) ?? "Client",
            revenue,
          })),
      };
    }

    case "get_inventory_analysis": {
      const [{ data: products, error: productsError }, { data: movements, error: movementsError }] =
        await Promise.all([
          supabase
            .from("products")
            .select("id, name, unit, min_stock_threshold")
            .eq("organization_id", orgId)
            .eq("is_active", true),
          supabase
            .from("inventory_movements")
            .select("product_id, movement_type, quantity")
            .eq("organization_id", orgId)
            .limit(30000),
        ]);

      if (productsError) throw new Error(`Impossible de lire les produits: ${productsError.message}`);
      if (movementsError) throw new Error(`Impossible de lire les mouvements de stock: ${movementsError.message}`);

      const stock = computeStock(movements ?? []);
      const sales = await getConfirmedSales(supabase, orgId, dateDaysAgo(30));
      const saleIds = sales.map((sale) => String(sale.id));
      const { data: items, error: itemsError } = saleIds.length
        ? await supabase.from("sale_items").select("sale_id, product_id, quantity").in("sale_id", saleIds).limit(30000)
        : { data: [], error: null };
      if (itemsError) throw new Error(`Impossible de lire les ventes produit: ${itemsError.message}`);

      const sold = new Map<string, number>();
      for (const item of items ?? []) {
        const id = String(item.product_id);
        sold.set(id, (sold.get(id) ?? 0) + Number(item.quantity));
      }

      const analysis = (products ?? []).map((product) => {
        const id = String(product.id);
        const currentStock = stock.get(id) ?? 0;
        const soldQuantity = sold.get(id) ?? 0;
        const avgDaily = soldQuantity / 30;
        const daysUntilStockout = avgDaily > 0 ? Math.floor(currentStock / avgDaily) : null;
        const threshold = Number(product.min_stock_threshold);
        const risk =
          currentStock <= 0
            ? "rupture"
            : currentStock <= threshold || (daysUntilStockout !== null && daysUntilStockout <= 7)
            ? "alerte"
            : "normal";

        return {
          product: product.name,
          unit: product.unit,
          current_stock: currentStock,
          minimum_threshold: threshold,
          sold_last_30d: soldQuantity,
          average_daily_consumption: Math.round(avgDaily * 100) / 100,
          estimated_days_until_stockout: daysUntilStockout,
          risk,
        };
      });

      return {
        period_days: 30,
        products_analyzed: analysis.length,
        alerts: analysis
          .filter((item) => item.risk !== "normal")
          .sort((a, b) => {
            const rank = { rupture: 0, alerte: 1, normal: 2 };
            return rank[a.risk] - rank[b.risk];
          })
          .slice(0, 15),
        healthy_stock_count: analysis.filter((item) => item.risk === "normal").length,
      };
    }

    case "get_receivables": {
      const sales = await getConfirmedSales(supabase, orgId);
      const saleIds = sales.map((sale) => String(sale.id));

      const [paymentsResult, customersResult] = await Promise.all([
        saleIds.length
          ? supabase.from("payments").select("sale_id, amount").in("sale_id", saleIds).limit(30000)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("customers").select("id, name").eq("organization_id", orgId).eq("is_active", true),
      ]);

      if (paymentsResult.error) throw new Error(`Impossible de lire les paiements: ${paymentsResult.error.message}`);
      if (customersResult.error) throw new Error(`Impossible de lire les clients: ${customersResult.error.message`);

      const paidBySale = new Map<string, number>();
      for (const payment of paymentsResult.data ?? []) {
        const id = String(payment.sale_id);
        paidBySale.set(id, (paidBySale.get(id) ?? 0) + Number(payment.amount));
      }

      const customerNames = new Map((customersResult.data ?? []).map((customer) => [String(customer.id), customer.name]));
      const byCustomer = new Map<string, { billed: number; paid: number }>();

      for (const sale of sales) {
        if (!sale.customer_id) continue;
        const id = String(sale.customer_id);
        const current = byCustomer.get(id) ?? { billed: 0, paid: 0 };
        current.billed += Number(sale.total_amount);
        current.paid += paidBySale.get(String(sale.id)) ?? 0;
        byCustomer.set(id, current);
      }

      const debtors = [...byCustomer.entries()]
        .map(([id, value]) => ({
          customer: customerNames.get(id) ?? "Client",
          billed: value.billed,
          paid: value.paid,
          outstanding: Math.max(0, value.billed - value.paid),
        }))
        .filter((item) => item.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);

      return {
        total_outstanding: debtors.reduce((sum, item) => sum + item.outstanding, 0),
        debtor_count: debtors.length,
        top_debtors: debtors.slice(0, 10),
      };
    }

    case "get_purchases_analysis": {
      const parsed = daysSchema.parse(
        rawArgs && typeof rawArgs === "object" ? rawArgs : {}
      );
      const period = parsed.period_days ?? 90;
      const since = dateDaysAgo(period);

      const { data: purchases, error: purchasesError } = await supabase
        .from("purchases")
        .select("id, supplier_id, total_amount, purchase_date, status")
        .eq("organization_id", orgId)
        .eq("status", "received")
        .gte("purchase_date", since)
        .order("purchase_date", { ascending: false })
        .limit(10000);

      if (purchasesError) throw new Error(`Impossible de lire les achats: ${purchasesError.message}`);
      const purchaseIds = (purchases ?? []).map((purchase) => String(purchase.id));
      if (!purchaseIds.length) {
        return { period_days: period, purchase_count: 0, total_purchase_cost: 0, top_suppliers: [], cost_changes: [] };
      }

      const supplierIds = [...new Set((purchases ?? []).map((purchase) => String(purchase.supplier_id)))];
      const [itemsResult, suppliersResult] = await Promise.all([
        supabase.from("purchase_items").select("purchase_id, product_id, quantity, unit_cost").in("purchase_id", purchaseIds).limit(30000),
        supabase.from("suppliers").select("id, name").in("id", supplierIds),
      ]);

      if (itemsResult.error) throw new Error(`Impossible de lire les lignes d'achat: ${itemsResult.error.message}`);
      if (suppliersResult.error) throw new Error(`Impossible de lire les fournisseurs: ${suppliersResult.error.message}`);

      const supplierNames = new Map((suppliersResult.data ?? []).map((supplier) => [String(supplier.id), supplier.name]));
      const bySupplier = new Map<string, number>();
      for (const purchase of purchases ?? []) {
        const id = String(purchase.supplier_id);
        bySupplier.set(id, (bySupplier.get(id) ?? 0) + Number(purchase.total_amount));
      }

      const productIds = [...new Set((itemsResult.data ?? []).map((item) => String(item.product_id)))];
      const productsResult = productIds.length
        ? await supabase.from("products").select("id, name, unit").in("id", productIds)
        : { data: [], error: null };
      if (productsResult.error) throw new Error(`Impossible de lire les produits achetés: ${productsResult.error.message}`);

      const productNames = new Map((productsResult.data ?? []).map((product) => [String(product.id), { name: product.name, unit: product.unit }]));
      const costHistory = new Map<string, Array<{ date: string; unit_cost: number }>>();

      for (const item of itemsResult.data ?? []) {
        const purchase = (purchases ?? []).find((candidate) => String(candidate.id) === String(item.purchase_id));
        if (!purchase) continue;
        const id = String(item.product_id);
        const list = costHistory.get(id) ?? [];
        list.push({ date: String(purchase.purchase_date), unit_cost: Number(item.unit_cost) });
        costHistory.set(id, list);
      }

      const costChanges = [...costHistory.entries()]
        .map(([id, entries]) => {
          const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
          if (sorted.length < 2) return null;
          const latest = sorted[sorted.length - 1];
          const previous = sorted[sorted.length - 2];
          if (previous.unit_cost <= 0) return null;
          const changePct = ((latest.unit_cost - previous.unit_cost) / previous.unit_cost) * 100;
          return {
            product: productNames.get(id)?.name ?? "Produit",
            latest_unit_cost: latest.unit_cost,
            previous_unit_cost: previous.unit_cost,
            change_percent: Math.round(changePct * 100) / 100,
            latest_date: latest.date,
          };
        })
        .filter(Boolean)
        .sort((a, b) => Math.abs((b as { change_percent: number }).change_percent) - Math.abs((a as { change_percent: number }).change_percent))
        .slice(0, 10);

      return {
        period_days: period,
        purchase_count: purchases?.length ?? 0,
        total_purchase_cost: (purchases ?? []).reduce((sum, purchase) => sum + Number(purchase.total_amount), 0),
        top_suppliers: [...bySupplier.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id, total]) => ({ supplier: supplierNames.get(id) ?? "Fournisseur", total })),
        cost_changes: costChanges,
      };
    }

    case "get_expenses_analysis": {
      const parsed = daysSchema.parse(
        rawArgs && typeof rawArgs === "object" ? rawArgs : {}
      );
      const period = parsed.period_days ?? 30;
      const { data, error } = await supabase
        .from("expenses")
        .select("category, description, amount, expense_date")
        .eq("organization_id", orgId)
        .gte("expense_date", dateDaysAgo(period))
        .order("expense_date", { ascending: false })
        .limit(10000);

      if (error) throw new Error(`Impossible de lire les dépenses: ${error.message}`);

      const byCategory = new Map<string, number>();
      for (const expense of data ?? []) {
        const key = String(expense.category);
        byCategory.set(key, (byCategory.get(key) ?? 0) + Number(expense.amount));
      }

      const total = (data ?? []).reduce((sum, expense) => sum + Number(expense.amount), 0);

      return {
        period_days: period,
        expense_count: data?.length ?? 0,
        total_expenses: total,
        average_expense: data?.length ? total / data.length : 0,
        top_categories: [...byCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([category, total]) => ({ category, total })),
      };
    }

    case "get_product_detail": {
      const parsed = nameSchema.parse(rawArgs);
      const escaped = parsed.name.replace(/[\\%_]/g, "\\$&");
      const { data: products, error } = await supabase
        .from("products")
        .select("id, name, unit, cost_price, sale_price, min_stock_threshold, is_active")
        .eq("organization_id", orgId)
        .ilike("name", `%${escaped}%`)
        .limit(5);

      if (error) throw new Error(`Impossible de rechercher le produit: ${error.message}`);
      if (!products?.length) return { matches: [] };

      const ids = products.map((product) => String(product.id));
      const [{ data: movements, error: movementError }, sales] = await Promise.all([
        supabase.from("inventory_movements").select("product_id, movement_type, quantity").eq("organization_id", orgId).in("product_id", ids).limit(30000),
        getConfirmedSales(supabase, orgId, dateDaysAgo(30)),
      ]);

      if (movementError) throw new Error(`Impossible de lire le stock du produit: ${movementError.message}`);

      const stock = computeStock(movements ?? []);
      const saleIds = sales.map((sale) => String(sale.id));
      const { data: items, error: itemError } = saleIds.length
        ? await supabase.from("sale_items").select("sale_id, product_id, quantity").in("sale_id", saleIds).in("product_id", ids).limit(30000)
        : { data: [], error: null };
      if (itemError) throw new Error(`Impossible de lire les ventes du produit: ${itemError.message}`);

      const sold = new Map<string, number>();
      for (const item of items ?? []) {
        const id = String(item.product_id);
        sold.set(id, (sold.get(id) ?? 0) + Number(item.quantity));
      }

      return {
        matches: products.map((product) => {
          const id = String(product.id);
          const soldLast30d = sold.get(id) ?? 0;
          const avgDaily = soldLast30d / 30;
          return {
            product: product.name,
            unit: product.unit,
            active: product.is_active,
            cost_price: Number(product.cost_price),
            sale_price: Number(product.sale_price),
            minimum_threshold: Number(product.min_stock_threshold),
            current_stock: stock.get(id) ?? 0,
            sold_last_30d: soldLast30d,
            average_daily_consumption: Math.round(avgDaily * 100) / 100,
            estimated_days_until_stockout: avgDaily > 0 ? Math.floor((stock.get(id) ?? 0) / avgDaily) : null,
          };
        }),
      };
    }

    case "get_customer_detail": {
      const parsed = nameSchema.parse(rawArgs);
      const escaped = parsed.name.replace(/[\\%_]/g, "\\$&");
      const { data: customers, error } = await supabase
        .from("customers")
        .select("id, name, phone, email, address, notes, is_active")
        .eq("organization_id", orgId)
        .ilike("name", `%${escaped}%`)
        .limit(5);

      if (error) throw new Error(`Impossible de rechercher le client: ${error.message}`);
      if (!customers?.length) return { matches: [] };

      const customerIds = customers.map((customer) => String(customer.id));
      const { data: sales, error: salesError } = await supabase
        .from("sales")
        .select("id, customer_id, total_amount, sale_date, status")
        .eq("organization_id", orgId)
        .eq("status", "confirmed")
        .in("customer_id", customerIds)
        .order("sale_date", { ascending: false })
        .limit(10000);

      if (salesError) throw new Error(`Impossible de lire l'historique du client: ${salesError.message}`);

      const saleIds = (sales ?? []).map((sale) => String(sale.id));
      const { data: payments, error: paymentsError } = saleIds.length
        ? await supabase.from("payments").select("sale_id, amount, payment_date, payment_method").in("sale_id", saleIds).limit(30000)
        : { data: [], error: null };
      if (paymentsError) throw new Error(`Impossible de lire les paiements du client: ${paymentsError.message}`);

      const paidBySale = new Map<string, number>();
      for (const payment of payments ?? []) {
        const id = String(payment.sale_id);
        paidBySale.set(id, (paidBySale.get(id) ?? 0) + Number(payment.amount));
      }

      return {
        matches: customers.map((customer) => {
          const customerSales = (sales ?? []).filter((sale) => String(sale.customer_id) === String(customer.id));
          const billed = customerSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
          const paid = customerSales.reduce((sum, sale) => sum + (paidBySale.get(String(sale.id)) ?? 0), 0);
          return {
            customer: customer.name,
            phone: customer.phone,
            email: customer.email,
            active: customer.is_active,
            confirmed_sales: customerSales.length,
            billed_total: billed,
            paid_total: paid,
            outstanding: Math.max(0, billed - paid),
            last_sale_date: customerSales[0]?.sale_date ?? null,
          };
        }),
      };
    }

    default:
      return { error: `Outil NOVA inconnu: ${String(name)}` };
  }
}
