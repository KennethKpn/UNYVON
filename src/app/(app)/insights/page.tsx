"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  TrendingDown,
  Users,
  Sparkles,
  ChevronRight,
  Package,
  Activity,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getNovaInsights } from "@/lib/supabase/nova-actions";
import type { NovaInsight, SignalType, SignalCategory } from "@/types";

const signalIcons: Record<SignalType, typeof AlertTriangle> = {
  stock_risk: Package,
  margin_drop: TrendingDown,
  receivable_concentration: Users,
  dead_stock: Package,
  anomaly: Activity,
};

const severityConfig: Record<string, { badge: "error" | "warning" | "default"; bg: string; text: string }> = {
  high: { badge: "error", bg: "bg-error/10", text: "text-error" },
  medium: { badge: "warning", bg: "bg-warning/10", text: "text-warning" },
  low: { badge: "default", bg: "bg-muted", text: "text-muted-foreground" },
};

const categoryLabels: Record<SignalCategory, string> = {
  stock: "Stock",
  margin: "Marge",
  receivable: "Créance",
  activity: "Activité",
  opportunity: "Opportunité",
};

const filterCategories: { value: string; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "stock", label: "Stock" },
  { value: "margin", label: "Marge" },
  { value: "receivable", label: "Créances" },
  { value: "activity", label: "Activité" },
  { value: "opportunity", label: "Opportunité" },
];

export default function InsightsPage() {
  const [insights, setInsights] = useState<NovaInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getNovaInsights();
        if (!cancelled) setInsights(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = filter === "all"
    ? insights
    : insights.filter((i) => i.signal.category === filter);

  const highCount = insights.filter((i) => i.signal.severity === "high").length;
  const mediumCount = insights.filter((i) => i.signal.severity === "medium").length;
  const lowCount = insights.filter((i) => i.signal.severity === "low").length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-[10px] bg-lavender-soft flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">NOVA</h1>
            <p className="text-sm text-muted">Intelligence et recommandations</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-[16px] bg-gradient-to-r from-lavender-soft to-surface border border-primary/10">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-ink">
              NOVA analyse vos opérations en temps réel.
            </p>
            <p className="text-xs text-muted mt-1">
              Les alertes ci-dessous sont générées automatiquement à partir de vos données. Les
              calculs sont déterministes ; NOVA explique et recommande.
            </p>
          </div>
        </div>
      </div>

      {/* Summary badges */}
      {!loading && !error && insights.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <Badge variant="info" className="gap-1">
            <Sparkles className="w-3 h-3" />
            {insights.length} signal{insights.length > 1 ? "s" : ""}
          </Badge>
          {highCount > 0 && (
            <Badge variant="error" className="gap-1">
              <AlertTriangle className="w-3 h-3" />
              {highCount} urgent{highCount > 1 ? "s" : ""}
            </Badge>
          )}
          {mediumCount > 0 && (
            <Badge variant="warning" className="gap-1">
              {mediumCount} moyen{mediumCount > 1 ? "s" : ""}
            </Badge>
          )}
          {lowCount > 0 && (
            <Badge variant="default" className="gap-1">
              {lowCount} info
            </Badge>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {filterCategories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilter(cat.value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              filter === cat.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted">NOVA analyse vos données...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="text-sm font-medium">Erreur de chargement</p>
                <p className="text-xs text-muted mt-1">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-muted" />
              <div>
                <p className="text-sm font-medium text-ink">
                  {insights.length === 0
                    ? "Aucun signal détecté"
                    : "Aucun signal pour ce filtre"}
                </p>
                <p className="text-xs text-muted mt-1">
                  {insights.length === 0
                    ? "Vos opérations semblent normales. NOVA continue d'analyser."
                    : "Essayez un autre filtre pour voir d'autres signaux."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signal cards */}
      <div className="space-y-4">
        {filtered.map((insight) => {
          const Icon = signalIcons[insight.signal.type] ?? AlertTriangle;
          const sev = severityConfig[insight.signal.severity] ?? severityConfig.low;

          return (
            <Card
              key={insight.id}
              variant="elevated"
              className="hover:shadow-md transition-shadow"
            >
              <CardContent>
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0",
                      sev.bg
                    )}
                  >
                    <Icon className={cn("w-5 h-5", sev.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={sev.badge}>
                        {insight.signal.severity === "high"
                          ? "Urgent"
                          : insight.signal.severity === "medium"
                          ? "Moyen"
                          : "Info"}
                      </Badge>
                      <Badge variant="default">
                        {categoryLabels[insight.signal.category]}
                      </Badge>
                    </div>
                    <h3 className="font-display font-semibold text-ink mb-1">
                      {insight.signal.title}
                    </h3>
                    <p className="text-sm text-muted leading-relaxed mb-2">
                      {insight.response.explanation}
                    </p>
                    <div className="p-3 rounded-lg bg-surface border border-border">
                      <p className="text-xs font-medium text-ink mb-1">
                        Recommandation
                      </p>
                      <p className="text-xs text-muted leading-relaxed">
                        {insight.response.recommendation}
                      </p>
                      {insight.response.actions.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {insight.response.actions.map((action, idx) => (
                            <li key={idx} className="text-xs text-muted flex items-start gap-1.5">
                              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                              {action}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent>
          <h3 className="font-display font-semibold text-sm text-ink mb-2">
            Règle NOVA
          </h3>
          <div className="space-y-1.5 text-xs text-muted">
            <p>• Les calculs financiers ne sont pas confiés au LLM.</p>
            <p>• Les règles déterministes identifient les signaux.</p>
            <p>• Le LLM explique les signaux avec le contexte.</p>
            <p>• Aucune action irréversible n&apos;est déclenchée sans validation humaine.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
