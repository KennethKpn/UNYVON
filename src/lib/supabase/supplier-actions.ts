"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Supplier,
  CreateSupplierInput,
  UpdateSupplierInput,
  DatabaseSupplier,
} from "@/types";

// ---------------------------------------------------------------------------
// Helpers : snake_case ↔ camelCase
// ---------------------------------------------------------------------------
import { normalizePhone } from "@/lib/utils/phone";

function toSupplier(row: DatabaseSupplier): Supplier {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    products: [],
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Role check helper
// ---------------------------------------------------------------------------

async function requireSupplierRole(
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
      "Les vendeurs et stockkeepers ne peuvent pas gérer les fournisseurs"
    );
  }

  return { orgId: org.organization_id as string };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function getSuppliers(): Promise<Supplier[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Erreur lors du chargement des fournisseurs: ${error.message}`
    );
  }

  return (data as DatabaseSupplier[]).map(toSupplier);
}

/**
 * Fournisseurs de l'organisation partageant un numéro normalisé identique.
 * Simple AVERTISSEMENT : pas de contrainte d'unicité, la décision finale
 * appartient à l'utilisateur.
 */
export async function findSupplierPhoneMatches(
  phone: string,
  excludeId?: string
): Promise<Supplier[]> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 3) return [];

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .neq("phone", null)
    .neq("id", excludeId ?? "");

  if (error) return [];
  return (data as DatabaseSupplier[])
    .map(toSupplier)
    .filter((s) => normalizePhone(s.phone) === normalized);
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(
      `Erreur lors du chargement du fournisseur: ${error.message}`
    );
  }

  return toSupplier(data as DatabaseSupplier);
}

export async function createSupplier(
  input: CreateSupplierInput
): Promise<Supplier> {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Le nom du fournisseur est requis");
  }

  const supabase = await createServerSupabase();
  const { orgId } = await requireSupplierRole(supabase, ["owner", "manager"]);

  const { data, error } = await supabase
    .from("suppliers")
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
    throw new Error(
      `Erreur lors de la création du fournisseur: ${error.message}`
    );
  }

  return toSupplier(data as DatabaseSupplier);
}

export async function updateSupplier(
  input: UpdateSupplierInput
): Promise<Supplier> {
  const supabase = await createServerSupabase();
  const { orgId } = await requireSupplierRole(supabase, ["owner", "manager"]);

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
    .from("suppliers")
    .update(updates)
    .eq("id", input.id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Erreur lors de la mise à jour du fournisseur: ${error.message}`
    );
  }

  return toSupplier(data as DatabaseSupplier);
}

// L'archivage (is_active=false) est privilégié à la suppression physique afin de
// conserver l'historique des achats rattachés à un fournisseur.
export async function archiveSupplier(id: string): Promise<Supplier> {
  return updateSupplier({ id, isActive: false });
}

export async function restoreSupplier(id: string): Promise<Supplier> {
  return updateSupplier({ id, isActive: true });
}
