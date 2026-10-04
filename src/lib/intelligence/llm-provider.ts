// ============================================================================
// NOVA LLM Provider Abstraction
// Fallback-first: works without any LLM API key
// ============================================================================

import type { NovaProviderConfig, NovaContext, NovaResponse } from "./types";
import { createGeminiInteraction } from "./gemini-client";

const envGeminiKey = process.env.GEMINI_API_KEY?.trim();

let configuredProvider: NovaProviderConfig = envGeminiKey
  ? {
      type: "gemini",
      apiKey: envGeminiKey,
      model: process.env.NOVA_GEMINI_MODEL?.trim() || "gemini-3.8-flash",
    }
  : { type: "fallback" };

export function configureNovaProvider(config: NovaProviderConfig) {
  configuredProvider = config;
}

export function getNovaProvider(): NovaProviderConfig {
  return configuredProvider;
}

function formatEvidenceForLLM(evidence: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`  ${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

export async function generateNovaResponse(context: NovaContext): Promise<NovaResponse> {
  if (configuredProvider.type === "fallback" || !configuredProvider.apiKey) {
    return generateFallbackResponse(context);
  }

  try {
    return await callLLMProvider(context, configuredProvider);
  } catch {
    return generateFallbackResponse(context);
  }
}

async function callLLMProvider(
  context: NovaContext,
  config: NovaProviderConfig
): Promise<NovaResponse> {
  const systemPrompt = `Tu es NOVA, l'intelligence d'UNYVON, un ERP pour PME agroalimentaires au Bénin.

Règles ABSOLUES:
1. Tu ne dois JAMAIS inventer de chiffres. Utilise UNIQUEMENT les données structurées fournies.
2. Tu ne dois JAMAIS recommander d'actions irréversibles (créer une vente, modifier un prix, enregistrer un paiement).
3. Tu expliques ce qui se passe, pourquoi, et ce qu'il faut faire.
4. Tu reformules les données structurées en texte clair et concis.
5. Réponds en français.
6. Maximum 3 phrases pour l'explication, 2 phrases pour la recommandation.`;

  const userPrompt = `Signal détecté: ${context.signal.title}
Type: ${context.signal.type}
Sévérité: ${context.signal.severity}
Données:
${formatEvidenceForLLM(context.evidence)}

Formule une réponse NOVA avec:
1. explanation: ce qui se passe (basé sur les données)
2. recommendation: ce qu'il faut faire
3. actions: liste de 1-3 actions concrètes`;

  if (config.type === "gemini") {
    const response = await createGeminiInteraction({
      input: userPrompt,
      systemInstruction: systemPrompt,
      tools: [],
      previousInteractionId: null,
    });

    return parseLLMResponse(context, response.output_text ?? "");
  }

  if (config.type === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseLLMResponse(context, content);
  }

  return generateFallbackResponse(context);
}

function parseLLMResponse(context: NovaContext, content: string): NovaResponse {
  const lines = content.split("\n").filter((l) => l.trim());
  let explanation = "";
  let recommendation = "";
  const actions: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("explanation:") || lower.includes("explication:")) {
      explanation = line.replace(/^.*?:\s*/i, "").trim();
    } else if (lower.includes("recommendation:") || lower.includes("recommandation:")) {
      recommendation = line.replace(/^.*?:\s*/i, "").trim();
    } else if (lower.startsWith("- ") || lower.startsWith("• ")) {
      actions.push(line.replace(/^[-•]\s*/, "").trim());
    }
  }

  if (!explanation) explanation = content.split("\n")[0] ?? context.signal.title;
  if (!recommendation) recommendation = "Consultez les données pour plus de détails.";

  return {
    signal: context.signal,
    explanation,
    recommendation,
    actions: actions.length > 0 ? actions : ["Vérifiez les données"],
  };
}

function generateFallbackResponse(context: NovaContext): NovaResponse {
  const { signal } = context;
  const e = signal.evidence;

  switch (signal.type) {
    case "stock_risk": {
      const stock = e.currentStock as number;
      const days = e.daysUntilStockout as number | null;
      const avg = e.avgDailyConsumption as number | null;
      const name = e.productName as string;
      const unit = e.unit as string;

      if (e.status === "out_of_stock") {
        return {
          signal,
          explanation: `${name} est en rupture de stock (0 ${unit}). Aucun stock disponible.`,
          recommendation: `Réapprovisionnez ${name} en urgence auprès de vos fournisseurs.`,
          actions: ["Contacter un fournisseur", "Créer un bon de commande"],
        };
      }

      if (e.status === "insufficient_data") {
        return {
          signal,
          explanation: `${name} a ${stock} ${unit} en stock, sous le seuil de ${(e.minStockThreshold as number)} ${unit}. Pas assez de données de vente pour estimer la durée.`,
          recommendation: `Surveillez les ventes de ${name} pour estimer le rythme de consommation.`,
          actions: ["Suivre les ventes produit", "Ajuster le seuil d'alerte"],
        };
      }

      return {
        signal,
        explanation: `${name} pourrait être épuisé dans environ ${days} jour${(days ?? 0) > 1 ? "s" : ""}. Votre rythme est d'environ ${avg} ${unit}/jour pour un stock de ${stock} ${unit}.`,
        recommendation: `Prévoyez un réapprovisionnement de ${name} avant l'épuisement du stock.`,
        actions: [
          "Créer un bon de commande",
          `Commander au moins ${Math.ceil((avg ?? 1) * 14)} ${unit} pour 2 semaines`,
          "Vérifier la disponibilité chez les fournisseurs",
        ],
      };
    }

    case "margin_drop": {
      const current = e.currentMargin as number;
      const prev = e.previousMargin as number;
      const drop = e.drop as number;

      return {
        signal,
        explanation: `Votre marge brute est passée de ${prev.toFixed(1)}% à ${current.toFixed(1)}%, soit une baisse de ${drop.toFixed(1)} points.`,
        recommendation: `Analysez les causes : hausse des coûts d'achat ou baisse des prix de vente.`,
        actions: [
          "Vérifier les prix d'achat récents",
          "Comparer les prix de vente pratiqués",
          "Identifier les produits à marge dégradée",
        ],
      };
    }

    case "receivable_concentration": {
      const top = e.topDebtors as Array<{ customerName: string; outstanding: number; sharePercent: number }>;
      const total = e.totalOutstanding as number;
      const conc = e.concentrationPercent as number;

      return {
        signal,
        explanation: `${top.length} client${top.length > 1 ? "s" : ""} concentre${top.length > 1 ? "nt" : ""} ${conc.toFixed(0)}% des créances (${top.map((d) => d.customerName).join(" et ")}). Total créances : ${total.toLocaleString("fr-FR")} FCFA.`,
        recommendation: `Diversifiez votre base clients ou relancez les gros débiteurs pour réduire le risque.`,
        actions: [
          ...top.map((d) => `Relancer ${d.customerName} (${d.outstanding.toLocaleString("fr-FR")} FCFA)`),
          "Évaluer les conditions de crédit",
        ],
      };
    }

    case "dead_stock": {
      const name = e.productName as string;
      const stock = e.currentStock as number;
      const unit = e.unit as string;

      if (e.status === "no_sales") {
        return {
          signal,
          explanation: `${name} a ${stock} ${unit} en stock mais aucune vente enregistrée sur la période analysée.`,
          recommendation: `Évaluez si ${name} est toujours demandé par vos clients.`,
          actions: [
            "Vérifier la demande client",
            "Envisager une promotion ou un déstockage",
          ],
        };
      }

      return {
        signal,
        explanation: `${name} tourne lentement : ${stock} ${unit} en stock avec un rythme de vente faible.`,
        recommendation: `Réduisez les commandes de ${name} ou stimulez les ventes.`,
        actions: ["Ajuster les prochaines commandes", "Proposer en promotion"],
      };
    }

    case "anomaly": {
      const month = e.month as string;

      if (e.dropPercent !== undefined) {
        return {
          signal,
          explanation: `Vos ventes de ${month} ont chuté de ${(e.dropPercent as number)}% par rapport à la moyenne des mois précédents.`,
          recommendation: `Analysez les causes de la baisse : saisonnalité, concurrence, ou problème opérationnel.`,
          actions: ["Comparer avec l'année précédente", "Vérifier les facteurs externes"],
        };
      }

      if (e.spikePercent !== undefined) {
        return {
          signal,
          explanation: `Vos dépenses de ${month} ont augmenté de ${(e.spikePercent as number)}% par rapport à la moyenne.`,
          recommendation: `Identifiez la catégorie de dépense en hausse et évaluez si elle est justifiée.`,
          actions: ["Détailler les dépenses par catégorie", "Comparer avec le budget"],
        };
      }

      if (e.increasePercent !== undefined) {
        return {
          signal,
          explanation: `Le coût d'achat moyen a augmenté de ${(e.increasePercent as number)}% en ${month}.`,
          recommendation: `Négociez avec vos fournisseurs ou explorez des alternatives.`,
          actions: ["Contacter les fournisseurs", "Comparer les prix concurrents"],
        };
      }

      return {
        signal,
        explanation: `Une anomalie a été détectée pour ${month}.`,
        recommendation: "Vérifiez les données manuellement.",
        actions: ["Consulter les détails"],
      };
    }

    default:
      return {
        signal,
        explanation: signal.title,
        recommendation: "Vérifiez les données pour plus de détails.",
        actions: ["Consulter les détails"],
      };
  }
}
