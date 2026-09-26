"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Shield,
  Zap,
  TrendingUp,
  Package,
  Users,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Star,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: Zap,
    title: "Une saisie, plusieurs effets",
    description:
      "Enregistrez une vente une seule fois. Le stock, la marge, la créance et le dashboard se mettent à jour automatiquement.",
  },
  {
    icon: Brain,
    title: "NOVA, votre intelligence",
    description:
      "Alertes de rupture, baisse de marge, concentration de créances — NOVA détecte les problèmes avant qu'ils ne coûtent de l'argent.",
  },
  {
    icon: BarChart3,
    title: "Dashboard dirigeant",
    description:
      "Ventes, marge, trésorerie, créances, stock critique — tout est visible en un coup d'œil. Pas de configurations complexes.",
  },
  {
    icon: Shield,
    title: "Données fiables",
    description:
      "Stock théorique vs stock réel. Ajustements traçables. Chaque chiffre est expliquable et vérifiable.",
  },
  {
    icon: Package,
    title: "Stock intelligent",
    description:
      "Suivez vos mouvements, détectez les écarts, anticipez les ruptures. Le système vous dit quoi réapprovisionner.",
  },
  {
    icon: Users,
    title: "Créances B2B",
    description:
      "Suivi par client, par ancienneté, par concentration. Les retards sont visibles avant de devenir des pertes.",
  },
];

const steps = [
  {
    step: "01",
    title: "Importez vos données",
    description: "Produits, clients, fournisseurs — en quelques minutes via CSV ou saisie directe.",
  },
  {
    step: "02",
    title: "Enregistrez vos opérations",
    description: "Ventes, achats, dépenses. Le système propage automatiquement les effets.",
  },
  {
    step: "03",
    title: "NOVA analyse et alerte",
    description:
      "Le moteur détecte anomalies, risques et opportunités. Vous savez quoi faire.",
  },
];

const pricingPlans = [
  {
    name: "Starter",
    price: "7 500",
    description: "Pour les très petites entreprises",
    features: [
      "1 utilisateur",
      "Ventes, stock, clients",
      "Dashboard de base",
      "Insights NOVA",
      "Support par message",
    ],
    cta: "Commencer gratuitement",
    highlighted: false,
  },
  {
    name: "Business",
    price: "15 000",
    description: "Pour les PME actives",
    features: [
      "5 utilisateurs",
      "Toutes les fonctionnalités",
      "Import CSV",
      "Créances B2B avancées",
      "Support prioritaire",
    ],
    cta: "Commencer gratuitement",
    highlighted: true,
  },
  {
    name: "Pro",
    price: "30 000",
    description: "Multi-sites et analyses avancées",
    features: [
      "Utilisateurs illimités",
      "Multi-points de vente",
      "Insights avancés",
      "Intégrations",
      "Support dédié",
    ],
    cta: "Commencer gratuitement",
    highlighted: false,
  },
];

const testimonials = [
  {
    name: "Ablam SEHOUETO",
    role: "Directeur, AgroDistrib Cotonou",
    quote:
      "Avant UNYVON, je ne savais jamais exactement ce que mes clients me devaient. Maintenant, tout est visible en temps réel.",
  },
  {
    name: "Kossi AGBOSSOU",
    role: "Gérant, Import-Export Kossi",
    quote:
      "Le système m'a alerté sur une baisse de marge que je n'aurais jamais vue seule. Ça m'a évité une perte de plusieurs centaines de milliers.",
  },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-surface/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center">
              <span className="text-white font-display font-bold text-sm">U</span>
            </div>
            <span className="font-display font-semibold text-lg text-ink">UNYVON</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted hover:text-text transition-colors">
              Fonctionnalités
            </a>
            <a href="#how-it-works" className="text-sm text-muted hover:text-text transition-colors">
              Comment ça marche
            </a>
            <a href="#pricing" className="text-sm text-muted hover:text-text transition-colors">
              Tarifs
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden md:block">
              <Button variant="ghost" size="sm">
                Se connecter
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">
                Essai gratuit
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-[10px] text-muted hover:text-text hover:bg-background transition-colors"
              aria-label="Menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-surface px-6 py-4 space-y-3">
            <a href="#features" className="block text-sm text-muted hover:text-text transition-colors py-2" onClick={() => setMobileMenuOpen(false)}>
              Fonctionnalités
            </a>
            <a href="#how-it-works" className="block text-sm text-muted hover:text-text transition-colors py-2" onClick={() => setMobileMenuOpen(false)}>
              Comment ça marche
            </a>
            <a href="#pricing" className="block text-sm text-muted hover:text-text transition-colors py-2" onClick={() => setMobileMenuOpen(false)}>
              Tarifs
            </a>
            <div className="pt-2 border-t border-border flex flex-col gap-2">
              <Link href="/login" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full">
                  Se connecter
                </Button>
              </Link>
              <Link href="/signup" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button className="w-full">
                  Essai gratuit
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-lavender-soft/60 via-background to-background" />
        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-32 md:pb-36">
          <div className="max-w-3xl mx-auto text-center">
            <Badge variant="info" className="mb-6">
              Pilotage opérationnel pour PME africaines
            </Badge>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-ink leading-tight tracking-tight">
              Votre entreprise travaille.
              <br />
              <span className="text-primary">Notre système transforme ce travail en décisions.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted max-w-2xl mx-auto leading-relaxed">
              Ventes, stock, marge, créances — tout est relié, analysé et mis en évidence par NOVA.
              Pas de saisie double. Pas de surprises.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg">
                  Commencer gratuitement
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button variant="outline" size="lg">
                  Voir la démo
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">
              Essai gratuit de 14 jours. Sans carte bancaire.
            </p>
          </div>

          {/* Dashboard Preview */}
          <div className="mt-16 md:mt-24 max-w-5xl mx-auto">
            <div className="rounded-card border border-border bg-surface shadow-lg overflow-hidden">
              <div className="h-10 border-b border-border flex items-center px-4 gap-2">
                <div className="w-3 h-3 rounded-full bg-error/60" />
                <div className="w-3 h-3 rounded-full bg-warning/60" />
                <div className="w-3 h-3 rounded-full bg-success/60" />
                <div className="ml-4 text-xs text-muted font-mono">unyvon.app/dashboard</div>
              </div>
              <div className="p-6 md:p-8">
                <div className="mb-6">
                  <p className="text-sm text-muted">Bonjour Patrick 👋</p>
                  <p className="text-xs text-muted mt-1">Voici ce qui mérite votre attention.</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: "CA ce mois", value: "4,28 M", color: "text-ink" },
                    { label: "Marge", value: "31,8 %", color: "text-success" },
                    { label: "Encaissements", value: "2,10 M", color: "text-info" },
                    { label: "Créances", value: "1,42 M", color: "text-warning" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-[12px] bg-background p-4">
                      <p className="text-xs text-muted">{kpi.label}</p>
                      <p className={`text-xl md:text-2xl font-display font-bold mt-1 ${kpi.color}`}>
                        {kpi.value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 rounded-[12px] bg-background p-4">
                    <p className="text-xs text-muted mb-3">Performance</p>
                    <div className="flex items-end gap-1 h-24">
                      {[40, 55, 45, 65, 50, 70, 60, 75, 80, 65, 85, 90].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-primary/20 rounded-t-sm"
                          style={{ height: `${h}%` }}
                        >
                          <div
                            className="w-full bg-primary rounded-t-sm"
                            style={{ height: "60%" }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[12px] bg-background p-4">
                    <p className="text-xs text-muted mb-3 flex items-center gap-1.5">
                      <span className="text-primary">✦</span> NOVA
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                        <span className="text-text">Stock riz risque de rupture</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs">
                        <TrendingUp className="w-3.5 h-3.5 text-error mt-0.5 shrink-0" />
                        <span className="text-text">Marge huile en baisse</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs">
                        <Users className="w-3.5 h-3.5 text-info mt-0.5 shrink-0" />
                        <span className="text-text">2 clients = 63 % créances</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos / Social proof */}
      <section className="py-12 border-y border-border bg-surface">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-sm text-muted mb-8">
            Utilisé par des distributeurs et grossistes à Cotonou
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 opacity-40">
            {["AgroDistrib", "Import-Export Kossi", "Distribution Zongo", "ToutCommerce"].map(
              (name) => (
                <span key={name} className="font-display font-semibold text-lg text-ink">
                  {name}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4">Comment ça marche</Badge>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-ink">
              Trois étapes. Pas de configuration complexe.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.step} className="text-center md:text-left">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-[12px] bg-lavender-soft text-primary font-display font-bold text-lg mb-4">
                  {s.step}
                </div>
                <h3 className="font-display text-lg font-semibold text-ink mb-2">{s.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 md:py-28 bg-surface border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4">Fonctionnalités</Badge>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-ink">
              Tout ce dont vous avez besoin.
              <br />
              <span className="text-muted">Rien de ce dont vous n&apos;avez pas.</span>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-card border border-border bg-background p-6 hover:shadow-md transition-shadow duration-300"
              >
                <div className="w-10 h-10 rounded-[10px] bg-lavender-soft flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-ink mb-2">{f.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What UNYVON is NOT */}
      <section className="py-20 md:py-28">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-ink">
              Ce que UNYVON n&apos;est pas
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              "Un ERP complexe à configurer pendant des semaines",
              "Un logiciel de comptabilité complète",
              "Un chatbot qui invente des chiffres",
              "Un outil qui demande une saisie administrative permanente",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-[12px] bg-background p-4 border border-border">
                <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                <span className="text-sm text-text">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 md:py-28 bg-surface border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4">Témoignages</Badge>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-ink">
              Ce que disent nos premiers utilisateurs
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="rounded-card border border-border bg-background p-6"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-text text-sm leading-relaxed mb-4 italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div>
                  <p className="font-display font-semibold text-sm text-ink">{t.name}</p>
                  <p className="text-xs text-muted">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4">Tarifs</Badge>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-ink">
              Un prix qui réduit vos pertes,
              <br />
              <span className="text-muted">pas un coût supplémentaire.</span>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-card border p-6 flex flex-col ${
                  plan.highlighted
                    ? "border-primary bg-surface shadow-lg ring-1 ring-primary/20"
                    : "border-border bg-background"
                }`}
              >
                {plan.highlighted && (
                  <Badge variant="info" className="self-start mb-4">
                    Populaire
                  </Badge>
                )}
                <h3 className="font-display font-semibold text-ink text-lg">{plan.name}</h3>
                <p className="text-xs text-muted mt-1">{plan.description}</p>
                <div className="mt-4 mb-6">
                  <span className="font-display text-3xl font-bold text-ink">{plan.price}</span>
                  <span className="text-sm text-muted ml-1">FCFA / mois</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-text">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="w-full">
                  <Button
                    variant={plan.highlighted ? "primary" : "outline"}
                    className="w-full"
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="py-20 md:py-28 bg-gradient-to-br from-primary to-primary-dark">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-6">
            Prêt à piloter votre entreprise avec confiance ?
          </h2>
          <p className="text-white/80 text-lg mb-10 max-w-2xl mx-auto">
            Créez votre compte en 2 minutes. Aucune carte bancaire requise. Votre première
            valeur est visible dès le premier jour.
          </p>
          <Link href="/signup">
            <Button
              size="lg"
              className="bg-white text-primary hover:bg-white/90 font-semibold"
            >
              Commencer gratuitement
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-ink">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center">
                <span className="text-white font-display font-bold text-sm">U</span>
              </div>
              <span className="font-display font-semibold text-lg text-white">UNYVON</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors">
                Fonctionnalités
              </a>
              <a href="#pricing" className="text-sm text-white/60 hover:text-white transition-colors">
                Tarifs
              </a>
              <a href="mailto:contact@unyvon.app" className="text-sm text-white/60 hover:text-white transition-colors">
                Contact
              </a>
              <Link href="/login" className="text-sm text-white/60 hover:text-white transition-colors">
                Connexion
              </Link>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-white/10 text-center">
            <p className="text-xs text-white/40">
              &copy; 2026 UNYVON. Tous droits réservés. Pilotage opérationnel pour PME africaines.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
