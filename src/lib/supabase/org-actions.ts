"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { resolveMemberOrg, resolveOwnedOrg } from "@/lib/supabase/org-resolve";

export type OrgActionState =
  | { ok: true; organizationId: string }
  | { ok: false; error: string }
  | { ok: false; error: "UNAUTHENTICATED" | "NOT_CONFIGURED" };

export type UpdateOrgActionState =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; error: "UNAUTHENTICATED" | "NOT_CONFIGURED" };

/** Org retournée par l'onboarding (pour hydratation / reprise). */
export interface OnboardingOrg {
  id: string;
  name: string;
  sector: string;
  currency: string;
}

/** Produit saisi dans le wizard. `id` vaut l'identifiant réel une fois sync. */
export interface OnboardingProduct {
  id: string | null;
  name: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  minStockThreshold: number;
  categoryId: string | null;
}

/** Client saisi dans le wizard. `id` vaut l'identifiant réel une fois sync. */
export interface OnboardingCustomer {
  id: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export type OnboardingState =
  | {
      ok: true;
      organization: OnboardingOrg | null;
      products: OnboardingProduct[];
      customers: OnboardingCustomer[];
      stockQuantities: Record<string, number>;
      hasConfirmedSale: boolean;
    }
  | { ok: false; error: "UNAUTHENTICATED" | "NOT_CONFIGURED" | string };

export type OnboardingSyncState =
  | {
      ok: true;
      productIds: Record<string, string>;
    }
  | { ok: false; error: string }
  | { ok: false; error: "UNAUTHENTICATED" | "NOT_CONFIGURED" | "NO_ORG" };

/**
 * Crée l'organisation du premier utilisateur réel — OU réutilise celle qui
 * existe déjà (idempotence : un reload du wizard ne doit jamais recréer une
 * org). Le trigger `handle_new_org` crée le membership owner + le trial.
 */
export async function createOrganizationAction(
  input: { name: string; sector: string; currency: string }
): Promise<OrgActionState> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Le nom de l'entreprise est requis." };
  }

  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  // Idempotence : si l'utilisateur a déjà une org, on la réutilise.
  const existingId = await resolveOwnedOrg(supabase, user.id);
  if (existingId) {
    return { ok: true, organizationId: existingId };
  }

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name,
      sector: input.sector.trim() || "Commerce général",
      currency: input.currency.trim() || "FCFA",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, organizationId: data.id };
}

/**
 * Met à jour l'organisation active de l'utilisateur connecté.
 * Nécessite le rôle owner ou manager.
 */
export async function updateOrganizationAction(
  input: { name: string; sector: string; currency: string }
): Promise<UpdateOrgActionState> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Le nom de l'entreprise est requis." };
  }

  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  const orgId =
    (await resolveOwnedOrg(supabase, user.id)) ??
    (await resolveMemberOrg(supabase, user.id));

  if (!orgId) {
    return { ok: false, error: "Aucune organisation trouvée." };
  }

  const { data: role } = await supabase.rpc("current_org_role", {
    org_id: orgId,
  });

  if (!["owner", "manager"].includes(role)) {
    return { ok: false, error: "Vous n'avez pas les droits pour modifier l'organisation." };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      name,
      sector: input.sector.trim() || "Commerce général",
      currency: input.currency.trim() || "FCFA",
    })
    .eq("id", orgId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Retourne l'état réel de l'onboarding pour l'utilisateur connecté :
 * l'org existante (si reprise après interruption), ses produits/clients
 * déjà persistés, le stock initial déjà saisi et l'éventuelle vente confirmée.
 * C'est la source de vérité qui hydrate le wizard au chargement.
 */
export async function getOnboardingStateAction(): Promise<OnboardingState> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  const orgId =
    (await resolveOwnedOrg(supabase, user.id)) ??
    (await resolveMemberOrg(supabase, user.id));

  // Aucune org : onboording vierge.
  if (!orgId) {
    return {
      ok: true,
      organization: null,
      products: [],
      customers: [],
      stockQuantities: {},
      hasConfirmedSale: false,
    };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, sector, currency")
    .eq("id", orgId)
    .single();

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit, cost_price, sale_price, min_stock_threshold, category_id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone, email, address, notes")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const { data: openings } = await supabase
    .from("inventory_movements")
    .select("product_id, quantity")
    .eq("organization_id", orgId)
    .eq("movement_type", "opening");

  const { data: confirmedSale } = await supabase
    .from("sales")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "confirmed")
    .limit(1)
    .maybeSingle();

  const stockQuantities: Record<string, number> = {};
  for (const m of openings ?? []) {
    stockQuantities[m.product_id] = m.quantity;
  }

  return {
    ok: true,
    organization: org
      ? { id: org.id, name: org.name, sector: org.sector, currency: org.currency }
      : null,
    products: (products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      costPrice: Number(p.cost_price),
      salePrice: Number(p.sale_price),
      minStockThreshold: p.min_stock_threshold,
      categoryId: p.category_id,
    })),
    customers: (customers ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
    })),
    stockQuantities,
    hasConfirmedSale: Boolean(confirmedSale),
  };
}

/**
 * Sync des produits de l'étape 3. Idempotent : un produit du même nom (org-
 * scopé) est mis à jour, jamais dupliqué. Retourne la map nom → id réel.
 */
export async function syncOnboardingProducts(input: {
  organizationId: string;
  products: OnboardingProduct[];
}): Promise<OnboardingSyncState> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  if (!input.organizationId) {
    return { ok: false, error: "NO_ORG" };
  }

  const productIds: Record<string, string> = {};

  for (const product of input.products) {
    const name = product.name.trim();
    if (!name) continue;

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("organization_id", input.organizationId)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error: updErr } = await supabase
        .from("products")
        .update({
          unit: product.unit.trim() || "unité",
          cost_price: product.costPrice,
          sale_price: product.salePrice,
          min_stock_threshold: product.minStockThreshold,
          category_id: product.categoryId ?? null,
        })
        .eq("id", existing.id)
        .eq("organization_id", input.organizationId);

      if (updErr) {
        return { ok: false, error: `Erreur produit "${name}": ${updErr.message}` };
      }
      productIds[name.toLowerCase()] = existing.id;
      continue;
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        organization_id: input.organizationId,
        name,
        unit: product.unit.trim() || "unité",
        cost_price: product.costPrice,
        sale_price: product.salePrice,
        min_stock_threshold: product.minStockThreshold,
        category_id: product.categoryId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, error: `Erreur produit "${name}": ${error.message}` };
    }
    productIds[name.toLowerCase()] = data.id;
  }

  return { ok: true, productIds };
}

/**
 * Sync du stock initial de l'étape 4. Idempotent : un seul mouvement
 * `opening` par (org, produit) ; les mouvements existants sont conservés.
 */
export async function syncOnboardingStock(input: {
  organizationId: string;
  entries: { productId: string; quantity: number }[];
}): Promise<OnboardingSyncState> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  if (!input.organizationId) {
    return { ok: false, error: "NO_ORG" };
  }

  for (const entry of input.entries) {
    if (entry.quantity <= 0) continue;

    const { data: existing } = await supabase
      .from("inventory_movements")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("product_id", entry.productId)
      .eq("movement_type", "opening")
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase.from("inventory_movements").insert({
      organization_id: input.organizationId,
      product_id: entry.productId,
      movement_type: "opening",
      quantity: entry.quantity,
      reason: "Stock initial — onboarding",
      created_by: user.id,
    });

    if (error) {
      return { ok: false, error: `Erreur stock initial: ${error.message}` };
    }
  }

  return { ok: true, productIds: {} };
}

/**
 * Sync des clients de l'étape 5. Idempotent : un client du même nom (org-
 * scopé) est réutilisé. Retourne la map nom → id réel.
 */
export async function syncOnboardingCustomers(input: {
  organizationId: string;
  customers: OnboardingCustomer[];
}): Promise<OnboardingSyncState> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  if (!input.organizationId) {
    return { ok: false, error: "NO_ORG" };
  }

  const customerIds: Record<string, string> = {};

  for (const customer of input.customers) {
    const name = customer.name.trim();
    if (!name) continue;

    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", input.organizationId)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (existing) {
      customerIds[name.toLowerCase()] = existing.id;
      continue;
    }

    const { data, error } = await supabase
      .from("customers")
      .insert({
        organization_id: input.organizationId,
        name,
        phone: customer.phone.trim() || null,
        email: customer.email.trim() || null,
        address: customer.address.trim() || null,
        notes: customer.notes.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, error: `Erreur client "${name}": ${error.message}` };
    }
    customerIds[name.toLowerCase()] = data.id;
  }

  return { ok: true, productIds: customerIds };
}

/**
 * Première vente de l'étape 6 — via exactement le même moteur métier que
 * les pages : draft → sale_items → confirm_sale → create_payment.
 * `unit_cost_snapshot` = coût réel du produit (jamais 0 si coût > 0).
 * Idempotent : une vente confirmée du même total ne recrée rien.
 */
export async function syncOnboardingSale(input: {
  organizationId: string;
  customerId: string | null;
  customerName: string;
  items: { productId: string; quantity: number; total: number }[];
  total: number;
  amountPaid: number;
}): Promise<OnboardingSyncState> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  if (!input.organizationId) {
    return { ok: false, error: "NO_ORG" };
  }

  if (!input.items.length) {
    return { ok: false, error: "La vente ne contient aucun article." };
  }

  // Coût unitaire réel pour le snapshot (source de vérité : products).
  const productIds = input.items.map((i) => i.productId);
  const { data: products } = await supabase
    .from("products")
    .select("id, cost_price")
    .in("id", productIds);
  const costByProduct = new Map<string, number>(
    (products ?? []).map((p) => [p.id, Number(p.cost_price)])
  );

  // Une éventuelle draft orpheline (reprise impossible) est clôturée avant
  // toute décision pour éviter l'accumulation de brouillons.
  const { data: orphanDrafts } = await supabase
    .from("sales")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("status", "draft")
    .eq("created_by", user.id);

  for (const draft of orphanDrafts ?? []) {
    const { error: cancelErr } = await supabase
      .from("sales")
      .update({ status: "cancelled" })
      .eq("id", draft.id)
      .eq("organization_id", input.organizationId);
    if (cancelErr) {
      return { ok: false, error: `Erreur réinitialisation vente: ${cancelErr.message}` };
    }
  }

  // Idempotence : une vente confirmée au même total existe déjà.
  const { data: existingConfirmed } = await supabase
    .from("sales")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("total_amount", input.total)
    .eq("status", "confirmed")
    .limit(1)
    .maybeSingle();

  if (existingConfirmed) {
    return { ok: true, productIds: {} };
  }

  const session = new Date().toISOString().split("T")[0];

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      organization_id: input.organizationId,
      customer_id: input.customerId,
      sale_date: session,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (saleErr) {
    return { ok: false, error: `Erreur vente: ${saleErr.message}` };
  }

  const saleItems = input.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.quantity > 0 ? Math.round(item.total / item.quantity) : 0,
    unit_cost_snapshot: costByProduct.get(item.productId) ?? 0,
  }));

  const { error: itemsErr } = await supabase.from("sale_items").insert(saleItems);
  if (itemsErr) {
    return { ok: false, error: `Erreur lignes vente: ${itemsErr.message}` };
  }

  const { error: confirmErr } = await supabase.rpc("confirm_sale", {
    p_sale_id: sale.id,
  });

  if (confirmErr) {
    return { ok: false, error: `Erreur confirmation vente: ${confirmErr.message}` };
  }

  if (input.amountPaid > 0) {
    const { error: payErr } = await supabase.rpc("create_payment", {
      p_sale_id: sale.id,
      p_amount: input.amountPaid,
      p_payment_method: "cash",
      p_reference: "Paiement initial — onboarding",
      p_notes: "Paiement enregistré lors de l'onboarding",
    });

    // Le paiement est non bloquant : la vente reste valide sans lui.
    if (payErr) {
      console.error("Onboarding payment error:", payErr.message);
    }
  }

  return { ok: true, productIds: {} };
}

export async function getSubscriptionAction() {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const orgId =
    (await resolveOwnedOrg(supabase, user.id)) ??
    (await resolveMemberOrg(supabase, user.id));

  if (!orgId) return null;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, trial_start, trial_end, plan")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();

  if (!sub) return null;

  const now = Date.now();
  const trialEnd = sub.trial_end ? new Date(sub.trial_end).getTime() : 0;
  const daysRemaining = trialEnd > 0 ? Math.max(0, Math.ceil((trialEnd - now) / 86400000)) : 0;

  return {
    status: sub.status as string,
    trialStart: sub.trial_start as string | null,
    trialEnd: sub.trial_end as string | null,
    plan: sub.plan as string | null,
    daysRemaining,
  };
}

/**
 * Retourne l'organisation active de l'utilisateur connecté : l'org qu'il a
 * créée la plus récente, sinon sa membership la plus récente. Choix
 * déterministe (jamais « la première renvoyée » sans ordre).
 */
export async function getActiveOrganizationAction() {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const orgId =
    (await resolveOwnedOrg(supabase, user.id)) ??
    (await resolveMemberOrg(supabase, user.id));

  if (!orgId) {
    const userMeta = user.user_metadata ?? {};
    return {
      organization: null,
      user: {
        id: user.id,
        email: user.email ?? "",
        firstName: (userMeta.firstName as string) ?? "",
        lastName: (userMeta.lastName as string) ?? "",
      },
    };
  }

  const { data } = await supabase
    .from("organizations")
    .select("id, name, sector, currency, organization_users(role)")
    .eq("id", orgId)
    .maybeSingle();

  const userMeta = user.user_metadata ?? {};

  return {
    organization: data ?? null,
    user: {
      id: user.id,
      email: user.email ?? "",
      firstName: (userMeta.firstName as string) ?? "",
      lastName: (userMeta.lastName as string) ?? "",
    },
  };
}