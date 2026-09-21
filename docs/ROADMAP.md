# UNYVON — ROADMAP PRODUIT

Suivi des évolutions planifiées. Une entrée = une intention produit, pas un engagement de date.

---

## Phase 3J — Corrections post test utilisateur (septembre 2026)

Corrections implémentées : page Fournisseurs dédiée, fournisseur obligatoire dans Nouvel achat, quantités d'achat vides à l'initialisation, archivage clients/fournisseurs, avertissement doublon téléphone client et fournisseur, menu utilisateur cliquable avec déconnexion confirmée, correction routes non protégées (suppliers, categories, expenses).

---

## 🔜 BACKLOG — Paiements opérateurs + justification/motif + rapprochement automatique

> **Statut : idée documentée — NE PAS implémenter dans cette phase.**
> Prérequis : étude technique/partenariat séparée, puis intégration des APIs.
> Aucune API opérateur ne doit être appelée par le code applicatif avant validation de cette étude.

### Objectif futur

Fermer la boucle trésorerie côté **achats fournisseurs** (le paiement des ventes clients est déjà couvert par la Phase 2H) :

```
Achat fournisseur (brouillon ou reçu)
  → Paiement Mobile Money initié depuis UNYVON
  → Transaction confirmée auprès de l'opérateur
  → Rattachement AUTOMATIQUE à l'achat concerné
  → Référence de transaction + motif/justification enregistrés
  → Historique / justificatif consultable
```

### Fonctionnalités visées

1. **Paiement opérateur depuis la fiche achat**
   - Bouton « Payer par Mobile Money » sur un achat (draft ou received, selon règle métier retenue).
   - Montant pré-rempli avec le total de l'achat, modifiable (paiement partiel possible).
2. **Motif / justification obligatoire**
   - Champ motif (ex. « Avance fournisseur Riz 25kg », « Solde facture BCA-2026-004 »).
   - Justificatif joint (photo reçu opérateur, PDF) — stockage à définir.
3. **Rattachement automatique**
   - Webhook/callback opérateur → confirmation de transaction → création automatique de l'enregistrement de paiement fournisseur rattaché à l'achat.
   - Référence de transaction opérateur stockée de façon immuable (traçabilité).
   - Statuts : `pending` → `confirmed` / `failed` / `expired`.
4. **Historique / justificatif**
   - Journal des paiements par achat et par fournisseur.
   - Vue « justificatif » : référence transaction, montant, date, motif, pièce jointe.

### Opérateurs envisagés (Bénin)

| Opérateur    | Service     | Notes intégration                                  |
| ------------ | ----------- | -------------------------------------------------- |
| MTN          | MTN MoMo    | API MoMo Collections — oauth2 + callback URL       |
| Moov / Telecel | Moov Money | API à qualifier via partenaire/agrégateur          |
| Celtiis      | Celtiis Cash | Couverture MTN Mobile Money S.A. — à qualifier    |

### Points d'étude technique/partenariat (à mener AVANT tout développement)

- **Statut juridique** : compte marchand agréé pour chaque opérateur (KYC entreprise, licence encaissement). Encaisser sans agrément n'est pas conforme.
- **Choix intégration** : API directes opérateur vs agrégateur régional (CinetPay, FedaPay, Molo, etc.). Un agrégateur réduit le travail d'intégration à une seule API multi-opérateurs et mutualise les callbacks.
- **Modèle de frais** : coût par transaction, plafonds,délais de règlement vers le compte entreprise.
- **Fiabilité des webhooks** : stratégie de retry, réconciliation par polling de secours, idempotence des callbacks (une même transaction ne doit jamais être rattachée deux fois).
- **Sécurité** : signature des webhooks, secret partagé, journal d'audit immuable.
- **Modèle de données** : nouvelle table `supplier_payments` (ou extension de `payments` avec `direction: in|out`) + `purchase_payments` (table de liaison), statuts, référence opérateur unique par org.
- **RLS multi-tenant** : les paiements fournisseurs héritent de l'isolation par `organization_id` et du rôle (owner/manager uniquement pour initier un paiement).

### Critères de succès (futurs tests)

- Un achat payé par MoMo voit son statut de paiement mis à jour automatiquement après confirmation opérateur.
- Aucun double rattachement possible pour une même référence de transaction.
- Un paiement échoué est visible avec son motif, relançable.
- L'historique est exportable (justificatif comptable).

---

## Idées non planifiées

- Aucune autre idée en attente à ce jour.
