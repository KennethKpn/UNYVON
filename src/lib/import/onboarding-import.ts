import type { DatabaseImportItem } from "./types";

export interface OnboardingImportStockDraft {
  productId: string;
  quantity: number;
  sourceItemId: string;
}

export interface OnboardingImportStockResult {
  stockByProductId: Record<string, number>;
  skippedItemIds: string[];
  conflictItemIds: string[];
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readNonNegativeInteger(item: DatabaseImportItem): number | null {
  const provenance = item.fields.stock_quantity;
  if (!provenance) return null;

  const normalized = provenance.normalized;
  if (typeof normalized !== "number") return null;
  if (!Number.isSafeInteger(normalized) || normalized < 0) return null;
  return normalized;
}

/**
 * Construit uniquement un brouillon de pré-remplissage.
 * Aucune écriture métier n'est effectuée ici.
 *
 * Règles de rattachement :
 * 1. une cible existante validée par import (match.existing_id) est prioritaire ;
 * 2. pour une création importée, le nom exact normalisé peut résoudre un produit
 *    unique déjà créé par le commit ;
 * 3. une résolution ambiguë ou une quantité documentaire non numérique est
 *    ignorée plutôt que devinée ;
 * 4. deux quantités différentes pour le même produit sont considérées comme
 *    contradictoires et ne sont pas pré-remplies.
 */
export function buildOnboardingImportStock(
  items: DatabaseImportItem[],
  products: Array<{ id: string; name: string }>
): OnboardingImportStockResult {
  const productIds = new Set(products.map((product) => product.id));
  const productsByName = new Map<string, string | null>();

  for (const product of products) {
    const key = normalizeName(product.name);
    const previous = productsByName.get(key);
    if (previous === undefined) {
      productsByName.set(key, product.id);
    } else if (previous !== product.id) {
      productsByName.set(key, null);
    }
  }

  const stockByProductId: Record<string, number> = {};
  const skippedItemIds: string[] = [];
  const conflictItemIds: string[] = [];
  const seenSourceByProduct = new Map<string, { quantity: number; itemId: string }>();

  for (const item of items) {
    if (item.entity_type !== "product" || item.status !== "imported") continue;

    const quantity = readNonNegativeInteger(item);
    if (quantity === null) {
      skippedItemIds.push(item.id);
      continue;
    }

    const matchedId = item.match?.existing_id ?? null;
    let productId: string | null = matchedId && productIds.has(matchedId) ? matchedId : null;

    if (!productId) {
      const name = item.fields.name?.normalized ?? item.fields.name?.raw ?? "";
      const resolved = productsByName.get(normalizeName(String(name)));
      productId = resolved ?? null;
    }

    if (!productId) {
      skippedItemIds.push(item.id);
      continue;
    }

    const previous = seenSourceByProduct.get(productId);
    if (previous && previous.quantity !== quantity) {
      delete stockByProductId[productId];
      conflictItemIds.push(previous.itemId, item.id);
      seenSourceByProduct.delete(productId);
      continue;
    }

    if (!previous) {
      stockByProductId[productId] = quantity;
      seenSourceByProduct.set(productId, { quantity, itemId: item.id });
    }
  }

  return { stockByProductId, skippedItemIds, conflictItemIds };
}
