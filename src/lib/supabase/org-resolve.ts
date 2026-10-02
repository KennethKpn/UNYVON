import type { createServerSupabase } from "./server";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Résout l'org la plus récente créée par l'utilisateur, sinon null.
 * Helper partagé (org-actions, import-actions) — jamais d'org fournie
 * par le navigateur : toujours dérivée de l'identité authentifiée.
 */
export async function resolveOwnedOrg(
  supabase: ServerSupabase,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Résout l'org la plus récente dont l'utilisateur est membre, sinon null.
 */
export async function resolveMemberOrg(
  supabase: ServerSupabase,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("organization_users")
    .select("organization_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.organization_id ?? null;
}
