"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  DatabaseCustomer,
} from "@/types";

// ---------------------------------------------------------------------------
// Helpers : snake_case ↔ camelCase
// ---------------------------------------------------------------------------
import { normalizePhone } from "@/lib/utils/phone";

function toCustomer(row: DatabaseCustomer, balance?: { totalPurchases: number; outstanding: number }): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalPurchases: balance?.totalPurchases ?? 0,
    outstandingBalance: balance?.outstanding ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Role check helper
// ---------------------------------------------------------------------------

async function requireCustomerRole(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  allowedRoles: string[]
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data: org } = await supabase
    .from("organization_users")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!org) throw new Error("Aucune organisation");

  const { data: role } = await supabase.rpc("current_org_role", {
    org_id: org.organization_id,
  });

  if (!allowedRoles.includes(role)) {
    throw new Error(
      "Les vendeurs et stockkeepers ne peuvent pas gérer les clients"
    );
  }

  return { orgId: org.organization_id as string };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getCustomers(): Promise<Customer[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Erreur lors du chargement des clients: ${error.message}`);
  }

  const customers = data as DatabaseCustomer[];
  if (!customers.length) return [];

  // Compute real balances from sales + payments
  const customerIds = customers.map((c) => c.id);
  const balances = new Map<string, { totalPurchases: number; outstanding: number }>();

  // Fetch confirmed sales per customer
  const { data: sales } = await supabase
    .from("sales")
    .select("id, customer_id, total_amount")
    .eq("status", "confirmed")
    .in("customer_id", customerIds);

  // Initialize balances
  for (const sale of sales ?? []) {
    const prev = balances.get(sale.customer_id) ?? { totalPurchases: 0, outstanding: 0 };
    prev.totalPurchases += sale.total_amount;
    prev.outstanding += sale.total_amount;
    balances.set(sale.customer_id, prev);
  }

  // Fetch payments for these sales
  if (sales?.length) {
    const saleIds = sales.map((s) => s.id);
    const { data: payments } = await supabase
      .from("payments")
      .select("sale_id, amount")
      .in("sale_id", saleIds);

    const saleToCustomer = new Map(sales.map((s) => [s.id, s.customer_id]));
    for (const p of payments ?? []) {
      const custId = saleToCustomer.get(p.sale_id);
      if (custId) {
        const prev = balances.get(custId);
        if (prev) prev.outstanding -= p.amount;
      }
    }
  }

  return customers.map((c) => toCustomer(c, balances.get(c.id)));
}

/**
 * Clients de l'organisation partageant un numéro normalisé identique.
 * Simple AVERTISSEMENT : pas de contrainte d'unicité, la décision finale
 * appartient à l'utilisateur (un même numéro peut être légitime).
 */
export async function findCustomerPhoneMatches(
  phone: string,
  excludeId?: string
): Promise<Customer[]> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 3) return [];

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .neq("phone", null)
    .neq("id", excludeId ?? "");

  if (error) return [];
  return (data as DatabaseCustomer[])
    .map((row) => toCustomer(row))
    .filter((c) => normalizePhone(c.phone) === normalized);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Erreur lors du chargement du client: ${error.message}`);
  }

  return toCustomer(data as DatabaseCustomer);
}

export async function createCustomer(
  input: CreateCustomerInput
): Promise<Customer> {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Le nom du client est requis");
  }

  const supabase = await createServerSupabase();

  const { orgId } = await requireCustomerRole(supabase, ["owner", "manager"]);

  const { data, error } = await supabase
    .from("customers")
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      address: input.address.trim() || null,
      notes: input.notes.trim() || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erreur lors de la création du client: ${error.message}`);
  }

  return toCustomer(data as DatabaseCustomer);
}

export async function updateCustomer(
  input: UpdateCustomerInput
): Promise<Customer> {
  const supabase = await createServerSupabase();

  const { orgId } = await requireCustomerRole(supabase, ["owner", "manager"]);

  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.phone !== undefined) updates.phone = input.phone.trim() || null;
  if (input.email !== undefined) updates.email = input.email.trim() || null;
  if (input.address !== undefined)
    updates.address = input.address.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  if (Object.keys(updates).length === 0) {
    throw new Error("Aucun champ à mettre à jour");
  }

  const { data, error } = await supabase
    .from("customers")
    .update(updates)
    .eq("id", input.id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Erreur lors de la mise à jour du client: ${error.message}`
    );
  }

  return toCustomer(data as DatabaseCustomer);
}

// L'archivage (is_active=false) est privilégié à la suppression physique afin de
// conserver l'historique des ventes/achats rattachés à un client.
export async function archiveCustomer(id: string): Promise<Customer> {
  return updateCustomer({ id, isActive: false });
}

export async function restoreCustomer(id: string): Promise<Customer> {
  return updateCustomer({ id, isActive: true });
}
