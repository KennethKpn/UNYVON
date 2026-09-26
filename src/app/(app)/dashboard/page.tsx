"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Loader2,
  Wallet,
  Receipt,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatFCFA } from "@/lib/utils";
import {
  getDashboardKPIs,
  getRecentActivity,
  getCriticalStock,
  getTopDebtors,
  getSalesPerformance,
  type DashboardKPIs,
  type ActivityItem,
  type CriticalStockItem,
  type TopDebtor,
  type MonthlyPerformance,
} from "@/lib/supabase/dashboard-actions";
import { getNovaInsights } from "@/lib/supabase/nova-actions";
import type { NovaInsight } from "@/types";

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [criticalStock, setCriticalStock] = useState<CriticalStockItem[]>([]);
  const [debtors, setDebtors] = useState<TopDebtor[]>([]);
  const [performance, setPerformance] = useState<MonthlyPerformance[]>([]);
  const [novaInsights, setNovaInsights] = useState<NovaInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [k, a, cs, d, p, nova] = await Promise.all([
        getDashboardKPIs(),
        getRecentActivity(8),
        getCriticalStock(),
        getTopDebtors(5),
        getSalesPerformance(),
        getNovaInsights(),
      ]);
      setKpis(k);
      setActivity(a);
      setCriticalStock(cs);
      setDebtors(d);
      setPerformance(p);
      setNovaInsights(nova);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial du dashboard
    void load();
  }, [load]);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const months = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
    return `${months[parseInt(month, 10) - 1]} ${year.slice(2)}`;
  };

  // Chart data from real performance
  const maxRevenue = Math.max(...performance.map((p) => p.revenue), 1);

  const kpiCards = kpis
    ? [
        {
          label: "Chiffre d'affaires",
          value: formatFCFA(kpis.totalRevenue),
          icon: TrendingUp,
          color: "text-ink",
          bgColor: "bg-lavender-soft",
        },
        {
          label: "Marge brute",
          value: `${kpis.grossMarginPct.toFixed(1).replace(".", ",")}`,
          unit: "%",
          icon: TrendingDown,
          color: "text-success",
          bgColor: "bg-success/10",
        },
        {
          label: "Encaissements",
          value: formatFCFA(kpis.totalReceipts),
          icon: Wallet,
          color: "text-info",
          bgColor: "bg-info/10",
        },
        {
          label: "Créances",
          value: formatFCFA(kpis.totalReceivables),
          icon: Users,
          color: kpis.totalReceivables > 0 ? "text-warning" : "text-success",
          bgColor: kpis.totalReceivables > 0 ? "bg-warning/10" : "bg-success/10",
        },
        {
          label: "Dépenses",
          value: formatFCFA(kpis.totalExpenses),
          icon: Receipt,
          color: "text-error",
          bgColor: "bg-error/10",
        },
        {
          label: "Trésorerie",
          value: formatFCFA(kpis.netCashflow),
          icon: kpis.netCashflow >= 0 ? TrendingUp : TrendingDown,
          color: kpis.netCashflow >= 0 ? "text-success" : "text-error",
          bgColor: kpis.netCashflow >= 0 ? "bg-success/10" : "bg-error/10",
        },
      ]
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Tableau de bord</h1>
        <p className="text-sm text-muted mt-1">
          Vue d&apos;ensemble de votre activité.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] bg-error/10 border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpiCards.map((kpi) => (
              <Card key={kpi.label} variant="elevated">
                <CardContent className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted font-medium">{kpi.label}</p>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className={cn("font-display text-xl font-bold", kpi.color)}>
                        {kpi.value}
                      </span>
                      {kpi.unit && (
                        <span className="text-xs text-muted">{kpi.unit}</span>
                      )}
                    </div>
                  </div>
                  <div className={cn("w-9 h-9 rounded-[10px] flex items-center justify-center", kpi.bgColor)}>
                    <kpi.icon className={cn("w-4 h-4", kpi.color)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Main content grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Performance Chart */}
            <Card variant="elevated" className="lg:col-span-2">
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-display font-semibold text-ink">Performance</h2>
                    <p className="text-xs text-muted mt-0.5">CA &amp; encaissements mensuels</p>
                  </div>
                  <Badge variant="info">12 mois</Badge>
                </div>
                {performance.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm text-muted">
                    Aucune donnée de performance
                  </div>
                ) : (
                  <div className="flex items-end gap-1.5 h-48">
                    {performance.map((p) => (
                      <div key={p.month} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex flex-col justify-end h-40 gap-0.5">
                          <div
                            className="w-full rounded-t-sm bg-primary"
                            style={{ height: `${(p.revenue / maxRevenue) * 100}%` }}
                          />
                          <div
                            className="w-full rounded-t-sm bg-info/40"
                            style={{ height: `${(p.receipts / maxRevenue) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted">{formatMonth(p.month)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-primary" /> CA
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-info/40" /> Encaissements
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* NOVA Panel */}
            <Card variant="elevated" className="border-primary/20">
              <CardContent>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-[10px] bg-lavender-soft flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-ink">NOVA</h2>
                    <p className="text-xs text-muted">Intelligence du jour</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {novaInsights.length === 0 && (
                    <p className="text-xs text-muted">Aucune alerte pour le moment.</p>
                  )}
                  {novaInsights.slice(0, 3).map((insight) => {
                    const Icon = insight.signal.severity === "high" ? AlertTriangle : TrendingDown;
                    return (
                      <div
                        key={insight.id}
                        className={cn(
                          "p-3 rounded-[12px] border transition-colors duration-200 hover:shadow-sm cursor-pointer",
                          insight.signal.severity === "high"
                            ? "bg-warning/5 border-warning/20"
                            : "bg-info/5 border-info/20"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className={cn(
                            "w-4 h-4 mt-0.5 shrink-0",
                            insight.signal.severity === "high" ? "text-warning" : "text-info"
                          )} />
                          <div>
                            <p className="text-sm font-medium text-ink">{insight.signal.title}</p>
                            <p className="text-xs text-muted mt-1 leading-relaxed">
                              {insight.response.explanation}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {novaInsights.length > 3 && (
                    <p className="text-xs text-muted text-center">
                      +{novaInsights.length - 3} autres signaux
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bottom row */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Recent Activity */}
            <Card variant="elevated">
              <CardContent>
                <h2 className="font-display font-semibold text-ink mb-4">Activité récente</h2>
                <div className="space-y-3">
                  {activity.length === 0 && (
                    <p className="text-xs text-muted text-center py-4">Aucune activité</p>
                  )}
                  {activity.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            item.type === "sale"
                              ? "bg-success/10"
                              : item.type === "payment"
                              ? "bg-info/10"
                              : "bg-warning/10"
                          )}
                        >
                          {item.type === "sale" ? (
                            <TrendingUp className="w-4 h-4 text-success" />
                          ) : item.type === "payment" ? (
                            <ArrowUpRight className="w-4 h-4 text-info" />
                          ) : (
                            <ArrowDownRight className="w-4 h-4 text-warning" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-ink">{item.description}</p>
                          <p className="text-xs text-muted">{formatDate(item.date)}</p>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-ink">{formatFCFA(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Stock critique */}
            <Card variant="elevated">
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display font-semibold text-ink">Stock critique</h2>
                  <Badge variant="warning">{criticalStock.length} alertes</Badge>
                </div>
                <div className="space-y-3">
                  {criticalStock.length === 0 && (
                    <p className="text-xs text-muted text-center py-4">Tous les stocks sont OK</p>
                  )}
                  {criticalStock.map((item) => {
                    const ratio = item.minStockThreshold > 0
                      ? item.stock / item.minStockThreshold
                      : 999;
                    return (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink">{item.productName}</p>
                          <p className="text-xs text-muted">
                            Seuil d&apos;alerte : {item.minStockThreshold} {item.unit}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-sm font-semibold",
                                item.status === "critical" ? "text-error" : "text-warning"
                              )}
                            >
                              {item.stock} {item.unit}
                            </span>
                            <div
                              className={cn(
                                "w-2 h-2 rounded-full",
                                item.status === "critical" ? "bg-error" : "bg-warning"
                              )}
                            />
                          </div>
                          <div className="w-24 h-1.5 bg-background rounded-full mt-1.5 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                item.status === "critical" ? "bg-error" : "bg-warning"
                              )}
                              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Top créances */}
            <Card variant="elevated">
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display font-semibold text-ink">Créances clients</h2>
                  <Badge variant="info">{debtors.length} client{debtors.length > 1 ? "s" : ""}</Badge>
                </div>
                <div className="space-y-3">
                  {debtors.length === 0 && (
                    <p className="text-xs text-muted text-center py-4">Aucune créance</p>
                  )}
                  {debtors.map((d) => (
                    <div
                      key={d.customerId}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">{d.customerName}</p>
                      </div>
                      <span className="text-sm font-semibold text-warning">
                        {formatFCFA(d.outstanding)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
