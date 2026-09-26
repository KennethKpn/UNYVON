# Phase 3L — Corrections de l'audit UI (source commune)

> **Statut : TERMINÉ — verdict PRODUCTION UI READY.**
> 899 constats Phase 3K → **0 constat** sur la matrice 17 routes × 7 viewports.
> Aucun test supprimé ni affaibli, aucune tolérance relevée, aucune couverture réduite.

---

## 1. Objectif

Corriger les 899 constats de l'audit Phase 3K (rapport [PHASE_3K_REPORT.md](PHASE_3K_REPORT.md))
**à la source** — tokens de design, composants partagés, points d'entrée uniques — puis
rerunner le scanner Playwright et comparer AVANT / APRÈS, sans toucher aux baselines
sauf changements visuels voulus et validés manuellement.

## 2. Corrections appliquées

### 2.1 Contraste (596 → 0) — tokens à la source

Toutes les couleurs de texte vivent dans `src/app/globals.css` (`@theme inline`).
Chaque token a été assombri en préservant sa teinte, avec le minimum de Luminance
Lfg tel que le ratio WCAG ≥ 4.5:1 sur **les trois bgs réellement utilisés** :
`white`, `background` (#F8F9FC), `lavender-soft` (#F1EFFF).

| Token | Avant | Après | Ratio avant (white/bg/lav) | Ratio après (white/bg/lav) |
|---|---|---|---|---|
| `success` | `#12B76A` | `#0C7D49` | 2.62 / 2.49 / 2.31 | **5.19 / 4.93 / 4.58** |
| `primary` | `#6D5DFB` | `#6556E9` | 4.56 / 4.33 / 4.02 | **5.17 / 4.91 / 4.56** |
| `warning` | `#F79009` | `#A05D06` | 2.35 / 2.23 / 2.07 | **5.17 / 4.91 / 4.56** |
| `error` | `#F04438` | `#C7382E` | 3.76 / 3.57 / 3.32 | **5.21 / 4.95 / 4.59** |
| `info` | `#2E90FA` | `#236EBF` | 3.24 / 3.08 / 2.86 | **5.18 / 4.92 / 4.57** |
| `muted` | `#667085` | `#646D82` | 4.97 / 4.73 / 4.39 | **5.18 / 4.92 / 4.57** |
| `primary-dark` | `#5143D6` | inchangé | 5.93 (lavender-soft) | identique — hover déjà conforme |

**Tokens déclarés mais absents (cause racine des 42 constats `ink`)** : les classes
`text-primary-foreground` et `text-muted-foreground` étaient utilisées
(`insights/page.tsx:32,148,149`) sans exister dans `@theme` → le texte héritait de
`ink` sur fond `bg-primary` / `bg-muted` (3.7–4.0:1). Ajout :
`--color-primary-foreground: #FFFFFF` et `--color-muted-foreground: #FFFFFF`
(uniquement sur fonds sombres : 5.17 et 5.18:1).

Aucune autre paire fg×bg du scanner n'existait : les 596 constats étaient
l'éclatement de ces 7 tokens sur white/background/lavender-soft.

### 2.2 Touch targets (215 → 0) — règle unique, viewports mobiles

`src/app/globals.css` :

```css
@media (max-width: 767.98px) {
  button:not(:disabled),
  a[href],
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
  select,
  textarea {
    min-height: 44px;
    min-width: 44px;
  }
}
```

- Balaie les 215 constats : boutons 40/36/28/24/16 px, inputs 40/42/20 px,
  liens de navigation 20 px de haut (footer + nav) — tous < 44 px.
- Checkbox / radio / range / color exclus (aucun constat, non pertinents au touch).
- Aucun override local : la règle vit au même endroit que le reset du projet.

### 2.3 ARIA (59 → 0) — labels sur l'action réelle

- `sidebar.tsx:194` — bouton de repli (icon seul, 52 constats = 13 routes × 4 viewports
  desktop) : `aria-label={collapsed ? "Déplier…" : "Replier…"}`.
- `sales/page.tsx` — 4 boutons icône seule (les 7 constats restants) :
  `aria-label="Confirmer la vente"`, `"Annuler la vente"`,
  `"Enregistrer un paiement"`, `"Fermer"` (modale nouvelle vente).
- `page.tsx` (landing) — `aria-expanded` ajouté sur le bouton de menu mobile.

### 2.4 Typographie (21 → 0) — 3 spots, texte ≥ 12px

| Fichier | Avant | Après |
|---|---|---|
| `(app)/dashboard/page.tsx:210` | `text-[10px]` (axe X des barres de CA) | `text-xs` (12px) |
| `(app)/customers/page.tsx:271` | `text-[11px]` (référence client) | `text-xs` (12px) |
| `(app)/insights/page.tsx:234` | `Badge … text-[10px]` (catégorie) | `Badge` (défaut 12px) |

21 constats = 3 spots × 7 viewports.

### 2.5 CTA / overflow / viewport (3 + 2 + 3 → 0) — nav landing

Sur `/` à 360px, le groupe CTA de la nav (« Se connecter » + « Essai gratuit » +
hamburger) débordait (overflow 360 et 390) et les liens de CTA faisaient 41px de haut.

- « Se connecter » masqué sur mobile (`hidden md:block`) — toujours accessible via
  le menu hamburger.
- Le menu mobile reçoit les deux CTA (`Se connecter` en outline, `Essai gratuit`
  en primaire) en cibles ≥ 44px.
- « Essai gratuit » et le hamburger passent à 44px via la règle globale §2.2.

## 3. AVANT / APRÈS (scanner Playwright)

| Kind | AVANT (run5) | APRÈS | Δ |
|---|---|---|---|
| `contrast` | 596 | **0** | −596 |
| `touch` | 215 | **0** | −215 |
| `aria` (info) | 59 | **0** | −59 |
| `typography` | 21 | **0** | −21 |
| `cta` | 3 | **0** | −3 |
| `viewport` | 3 | **0** | −3 |
| `overflow` | 2 | **0** | −2 |
| **Total** | **899** (840 fail + 59 info) | **0** | **−100%** |

Après le rerun complet, `e2e/artifacts/` reste vide : `recordFindings` n'écrit
`findings.jsonl` que s'il y a ≥ 1 finding — absence de fichier = zéro constat
sur les 17 routes × 7 viewports (119 passages d'audit).

## 4. Validation

| Gate | Résultat |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** — `✓ Compiled successfully` |
| `npx playwright test` (complet) | **763/763 — 313 passed, 450 skipped\*, 0 failed** (18.1 min, 0 flake) |
| Scanner findings | **0** (vs 899) |
| Baselines visuelles | **80/80 au vert** (74 routes + 6 modales) |

\* Les 450 `skipped` sont structurels et identiques dans tous les runs (hors matrice
visuelle : chaque projet Playwright ne capture que ses viewports). Aucun test n'a
été supprimé, commenté, ni réduit.

### Baselines régénérées (5) — après inspection visuelle des diffs

Aucune régénération à l'aveugle : chaque diff a été ouvert et validé avant
`--update-snapshots` ciblé (2 specs, 5 images) :

| Baseline | Diff constaté | Décision |
|---|---|---|
| `vp-360x800/landing.png` | nav : « Se connecter » masqué, CTA/hamburger 44px | voulu (§2.5) |
| `vp-360x800/insights.png` | chips de filtre 44px + reflow badges 12px + tokens | voulu (§2.1/2.2/2.4) |
| `vp-360x800/settings.png` | inputs/bouton Enregistrer 44px + tokens | voulu (§2.1/2.2) |
| `vp-360x800/modal-sales.png` | modale 699→709px : champs/boutons 44px | voulu (§2.2) |
| `vp-360x800/modal-payment.png` | idem | voulu (§2.2) |

Les 75 autres baselines (dont les 1920×1080) n'ont pas bougé : sous la tolérance
`maxDiffPixelRatio: 0.02` — les nouvelles valeurs restent visuellement proches de
l'identité UNYVON (teintes conservées, luminance seule ajustée).

## 5. Anti-slop — conformité design doctrine

- **Tokens du projet uniquement** : les 13 tokens `DESIGN_THEMES`-compatibles de
  `globals.css` ont été ajustés (teintes d'origine préservées) ; aucune palette
  ni police ad hoc introduite.
- **Composants partagés** : `button.tsx`, `input.tsx`, `badge.tsx`, `card.tsx`
  inchangés — correctifs via tokens + règle mobile globale (zéro override local).
- **4–6 couleurs max, une seule accent** : palette inchangée en nombre et en rôle.
- **Texte ≥ 14px** (12px minimum pour les labels techniques conformes au système) —
  plus aucun `text-[10px]` / `text-[11px]` dans `src/`.
- **Cibles ≥ 44px sur mobile, focus visibles, `prefers-reduced-motion`** : déjà en
  place, la règle §2.2 complète les cibles.
- **Aucune métrique inventée, aucun texte générique ajouté.**

## 6. Fichiers modifiés

### Source (7)

- `src/app/globals.css` — 6 tokens assombris, 2 tokens foreground ajoutés,
  règle mobile 44×44.
- `src/app/page.tsx` — nav mobile (CTA répartis), `aria-expanded`.
- `src/components/layout/sidebar.tsx` — `aria-label` bouton repli.
- `src/app/(app)/sales/page.tsx` — 4 `aria-label` boutons icône.
- `src/app/(app)/dashboard/page.tsx` — `text-[10px]` → `text-xs`.
- `src/app/(app)/customers/page.tsx` — `text-[11px]` → `text-xs`.
- `src/app/(app)/insights/page.tsx` — badge `text-[10px]` retiré.

### Baselines (5)

- `e2e/screenshots/vp-360x800/` — `landing.png`, `insights.png`, `settings.png`,
  `modal-sales.png`, `modal-payment.png` (§4).

## 7. Verdict

**PRODUCTION UI READY.**

Justification :

1. **0 constat** sur la matrice complète (17 routes × 7 viewports, 119 passages) —
   contraste ≥ 4.5:1, touch ≥ 44×44 (mobile), texte ≥ 12px, aria sur les actions
   icône, débordements nuls.
2. **Toutes les gates au vert** : tsc, lint, build, Playwright 763/763,
   80/80 baselines visuelles.
3. **Corrections à la source** : tokens (`globals.css`) + règle mobile unique —
   aucun correctif dispersé, maintenable en un point.
4. **Identité visuelle conservée** : teintes d'origine, luminance seule ajustée,
   5 baselines régénérées après validation manuelle des diffs.
5. **Intégrité des tests** : 0 test supprimé / affaibli / réduit ; tolérances
   inchangées (`maxDiffPixelRatio: 0.02`).

## 8. Suites possibles (non bloquantes)

- Surveillance : toute nouvelle couleur de texte doit passer 4.5:1 sur
  white / background / lavender-soft avant d'entrer dans `globals.css`.
- `aria` des futures pages : systématiser `aria-label` sur les boutons icône
  (pattern déjà posé sur `sidebar.tsx` et `sales/page.tsx`).
