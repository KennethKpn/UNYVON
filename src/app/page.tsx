"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Shield,
  Zap,
  Package,
  Users,
  UserRound,
  CheckCircle2,
  ChevronRight,
  Star,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CrowdCanvas } from "@/components/ui/skiper39";

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

          {/* Product preview — capture réelle du dashboard */}
          <div className="relative mx-auto mt-16 w-full max-w-6xl md:mt-24">
            <div aria-hidden="true" className="absolute -inset-8 rounded-[40px] bg-primary/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[22px] border border-white/80 bg-white p-2 shadow-[0_32px_90px_-32px_rgba(49,38,125,0.34)] ring-1 ring-black/[0.04] sm:rounded-[26px] sm:p-3">
              <div className="flex h-10 items-center gap-2 border-b border-border px-2 sm:h-12 sm:px-3">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F28B82]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F5C36A]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#72C39B]" />
                </div>
                <div className="ml-2 flex h-7 min-w-0 flex-1 items-center rounded-md bg-background px-3 text-left text-[10px] text-muted sm:ml-4 sm:text-xs">
                  <span className="truncate">unyvon.app/dashboard</span>
                </div>
                <span className="hidden shrink-0 text-[10px] font-medium text-muted sm:block">Aperçu du produit</span>
              </div>
              <div className="relative overflow-hidden rounded-b-[16px] bg-[#F8F9FC] sm:rounded-b-[18px]">
                <Image
                  src="/images/landing/unyvon-dashboard-real.png"
                  alt="Capture du véritable tableau de bord UNYVON avec ses six indicateurs, le graphique de performance et les alertes NOVA"
                  width={1920}
                  height={1080}
                  priority
                  sizes="(max-width: 1280px) 100vw, 1152px"
                  className="block h-auto w-full"
                />
                <div aria-hidden="true" className="absolute right-[0.4%] top-[0.5%] z-10 flex h-[5.5%] w-[10%] items-center justify-center bg-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lavender-soft text-primary">
                    <UserRound className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute -bottom-5 left-5 hidden items-center gap-2 rounded-full border border-white/80 bg-white/95 px-4 py-2.5 text-xs font-medium text-text shadow-lg backdrop-blur sm:flex">
              <span className="h-2 w-2 rounded-full bg-success" />
              Les indicateurs essentiels réunis
            </div>
            <div className="pointer-events-none absolute -right-3 top-[23%] hidden rounded-2xl border border-white/80 bg-white/95 px-4 py-3 shadow-xl backdrop-blur lg:block">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">NOVA</p>
              <p className="mt-1 text-xs font-medium text-ink">Les signaux à surveiller</p>
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
      <section
        id="how-it-works"
        className="relative overflow-hidden bg-background pt-20 pb-10 md:pt-28 md:pb-12"
      >
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <Badge className="mb-4">Comment ça marche</Badge>
            <h2 className="font-display text-3xl font-bold text-ink md:text-4xl">
              Trois étapes. Pas de configuration complexe.
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.step} className="text-center md:text-left">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[12px] bg-lavender-soft font-display text-lg font-bold text-primary">
                  {s.step}
                </div>
                <h3 className="mb-2 font-display text-lg font-semibold text-ink">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{s.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Illustration décorative : foule en mouvement, sur le même fond que la section. */}
        <div className="relative mx-auto mt-7 h-[132px] w-full max-w-[1600px] sm:h-[148px] md:mt-8 md:h-[168px] lg:h-[180px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[3%] bottom-[18px] h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent"
          />
          <CrowdCanvas className="absolute inset-x-0 top-0 h-[calc(100%-18px)] w-full" />
          <span className="pointer-events-none absolute bottom-0 right-6 text-[9px] leading-[12px] text-muted/45">
            Illustrations Open Peeps · Motion adapté de Skiper UI
          </span>
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

      {/* NOVA — zoom sur les alertes du produit */}
      <section className="overflow-hidden border-y border-border bg-surface py-20 md:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
          <div className="max-w-xl">
            <Badge variant="info" className="mb-5">NOVA · Intelligence opérationnelle</Badge>
            <h2 className="font-display text-3xl font-bold leading-tight text-ink md:text-4xl">
              Les signaux importants ne se perdent plus dans vos chiffres.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted">
              NOVA met en évidence les situations qui méritent votre attention : risque de rupture,
              baisse de marge ou concentration des créances. Les alertes restent proches de vos
              indicateurs pour vous aider à comprendre où agir.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Stock critique", "Marge", "Créances"].map((label) => (
                <span key={label} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-text">
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto h-[300px] w-full max-w-[620px] overflow-hidden rounded-[22px] border border-border bg-[#F8F9FC] shadow-[0_24px_60px_-34px_rgba(31,24,86,0.32)] sm:h-[360px]">
            <Image
              src="/images/landing/unyvon-dashboard-real.png"
              alt="Détail du tableau de bord UNYVON mettant en regard la performance et le panneau d'alertes NOVA"
              width={1920}
              height={1080}
              sizes="(max-width: 1024px) 100vw, 620px"
              className="absolute left-[-340px] top-[-48px] h-[460px] w-auto max-w-none"
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-[28%] bg-gradient-to-r from-[#F8F9FC] via-[#F8F9FC]/85 to-transparent" />
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/80 bg-white/95 px-3 py-2 text-[11px] font-medium text-text shadow-md">
              Vue du produit · NOVA
            </div>
          </div>
        </div>
      </section>

      {/* Expérience mobile — capture réelle dans un mockup iPhone dessiné en CSS */}
      <section className="relative overflow-hidden py-20 md:py-28">
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-lavender-soft/80 via-background to-background" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2 md:gap-16">
          <div className="order-2 flex justify-center md:order-1">
            <div className="relative mx-auto flex w-full max-w-[500px] justify-center py-5 sm:py-0">
              <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[68%] w-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl" />

              {/* Châssis titane, verre noir et écran */}
              <div className="relative z-10 w-[min(68vw,264px)] rounded-[3.25rem] bg-[linear-gradient(135deg,#F1F3F6_0%,#9EA4AE_5%,#343943_11%,#08090C_17%,#08090C_83%,#5B626D_91%,#E8EAEE_100%)] p-[5px] shadow-[0_34px_70px_-24px_rgba(25,22,56,0.5),0_12px_28px_-14px_rgba(0,0,0,0.5)]">
                {/* Boutons latéraux du châssis */}
                <div aria-hidden="true" className="absolute -left-[3px] top-[19%] z-20 h-8 w-[4px] rounded-l-full bg-gradient-to-r from-[#626874] to-[#C7CBD2] shadow-sm" />
                <div aria-hidden="true" className="absolute -left-[3px] top-[26%] z-20 h-12 w-[4px] rounded-l-full bg-gradient-to-r from-[#626874] to-[#C7CBD2] shadow-sm" />
                <div aria-hidden="true" className="absolute -right-[3px] top-[24%] z-20 h-16 w-[4px] rounded-r-full bg-gradient-to-l from-[#626874] to-[#C7CBD2] shadow-sm" />
                <div className="relative rounded-[2.95rem] border border-white/15 bg-[#07080B] p-[5px]">
                  <div className="relative aspect-[390/844] overflow-hidden rounded-[2.58rem] bg-white ring-1 ring-black/10">
                    <Image
                      src="/images/landing/unyvon-dashboard-mobile.png"
                      alt="Capture réelle du tableau de bord mobile UNYVON : chiffre d’affaires, marge, encaissements, créances, dépenses, trésorerie et performance"
                      fill
                      sizes="(max-width: 768px) 68vw, 264px"
                      className="object-cover object-top"
                    />
                    {/* Îlot dynamique du téléphone */}
                    <div aria-hidden="true" className="absolute left-1/2 top-[9px] z-20 flex h-[25px] w-[82px] -translate-x-1/2 items-center justify-end rounded-full bg-black px-2 shadow-inner">
                      <span className="h-2 w-2 rounded-full bg-[#18222D] ring-1 ring-[#344050]/70" />
                    </div>
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[2.58rem] ring-1 ring-inset ring-white/25" />
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute bottom-[4%] right-[2%] z-20 hidden items-center gap-2 rounded-full border border-white/80 bg-white/95 px-4 py-2.5 text-xs font-semibold text-text shadow-xl backdrop-blur sm:flex">
                <span className="h-2 w-2 rounded-full bg-success" />
                Aperçu mobile réel
              </div>
            </div>
          </div>

          <div className="order-1 max-w-xl md:order-2">
            <Badge variant="info" className="mb-5">Une expérience qui s&apos;adapte à vous</Badge>
            <h2 className="font-display text-3xl font-bold leading-tight text-ink md:text-4xl">
              Votre activité reste lisible, même sur petit écran.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted">
              Retrouvez vos indicateurs et les informations prioritaires depuis une interface
              responsive, pensée pour rester claire sur ordinateur, tablette et téléphone.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup">
                <Button size="lg">
                  Commencer gratuitement
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button variant="outline" size="lg">
                  Explorer la démo
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
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
              className="bg-white text-ink! hover:bg-white/90 font-semibold"
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
