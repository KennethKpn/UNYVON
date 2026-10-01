# Smart Data Import — intégrité Storage (revue PR #1)

Périmètre : suppression de document, policies Storage `imports_*`, métadonnées
déclarées avant upload. Références : `supabase/migrations/0011_import.sql`,
`supabase/migrations/0012_import_storage_integrity.sql`,
`src/lib/supabase/import-actions.ts`, `src/lib/import/storage-client.ts`.

## 1. Suppression d'un document (`deleteImportDocument`)

PostgreSQL et Storage n'ont **aucune transaction transversale** : chaque étape
est indépendante. Ordre retenu et compensation :

| Étape | Action | En cas d'échec |
|---|---|---|
| 1 | Pré-vérifications (auth, rôle owner/manager, état ∈ `uploading`/`uploaded`/`failed`, chemin Storage conforme et appartenant au document) | Aucune mutation : erreur, tout est intact |
| 2 | Suppression de la row `import_documents` | Erreur propagée, **objet Storage intact** |
| 3 | Suppression de l'objet Storage (`storage.from("imports").remove`) | **Compensation** : la row (lue en 1) est réinsérée → état « row + objet » restauré, erreur retournée, suppression rejouable |

**Pourquoi cet ordre et pas l'inverse** : si l'objet était supprimé en premier
et que PostgreSQL échouait ensuite, un fichier encore référencé serait détruit
— son contenu n'est pas reconstituable, aucune compensation possible.

**Double panne** (étape 3 échoue **et** la réinsertion de compensation échoue) :
l'objet peut rester orphelin. L'erreur expose alors le chemin exact
(`Objet Storage orphelin possible [chemin]`) pour nettoyage manuel/automatisé.
C'est la seule situation où un orphelin peut exister.

**Contrat policy associé** : `imports_delete_owner_manager` ne réclame
**pas** l'existence de la row — sinon la suppression de l'objet après l'étape 2
serait toujours refusée.

Tests : `src/lib/import/import-actions.test.ts` (describe `deleteImportDocument`,
10 cas dont compensation, double panne, échec DB sans appel Storage, garde de
chemin) et `supabase/verify-import-storage.sql` § 2.7 (row puis objet, ROLLBACK).

## 2. Fenêtre d'upload et immuabilité (`0012_import_storage_integrity.sql`)

| État du document | INSERT objet | UPDATE objet |
|---|---|---|
| `uploading` | autorisé | autorisé (relance d'upload) |
| `uploaded`, `parsing`, `parsed`, `extracting`, `extracted`, `failed` | **refusé** | **refusé** |

- Avant 0012, les deux policies ne vérifiaient que l'**existence** de la row :
  un document `uploaded` pouvait être écrasé.
- L'objet n'est créable/modifiable que si `id`/`session_id`/`organization_id`
  de la row correspondent **exactement** au chemin et que l'utilisateur est
  owner/manager de l'org (inchangé depuis 0011).
- Retour à l'écriture : seulement via le graphe de transitions
  (`failed → uploading`, `IMPORT_DOCUMENT_TRANSITIONS`) ou suppression
  complète (row + objet).
- Les 4 noms de policies sont conservés (drop + create) → `verify-import.sql`
  § 1.7 (compte = 4) reste valide.

Tests : `src/lib/import/storage-integrity.test.ts` (définition *effective*
verrouillée : dernière migration créant chaque policy),
`src/lib/import/verify-scripts-cleanup.test.ts` (réversibilité des scripts
`verify-*.sql`) et `supabase/verify-import-storage.sql` § 1 (catalogue) +
§ 2 (aller-retour).

### 2.1 Passage à `uploaded` subordonné à l'objet (`markImportDocumentUploaded`)

`markImportDocumentUploaded` est le pivot qui **ferme** la fenêtre d'upload
(policies `imports_insert/update` dès lors refusées) et **ouvre** l'extraction.
Vérifier uniquement le graphe d'états laissait un client obtenir `uploaded`
**sans un seul octet stocké** : extraction sur objet absent, et contenu
définitivement immuable donc non rattrapable.

| Ordre | Contrôle | Échec |
|---|---|---|
| 1 | auth (`requireAuth`) | aucune écriture, aucun accès Storage |
| 2 | rôle owner/manager **de l'organisation du document** | idem |
| 3 | graphe d'états (`uploading → uploaded`) | idem |
| 4 | chemin Storage conforme et **appartenant au document** (`assertOwnedStoragePath`) | idem |
| 5 | **présence réelle de l'objet** au chemin exact (`.list(folder, { search })` + nom exact + `id` non nul) | idem — la row reste `uploading` |

- L'existence est lue via la policy `imports_select_owner_manager` : un objet
  hors périmètre n'est pas visible, donc jamais compté comme présent.
- Correspondance **exacte** du nom : ni un nom partageant un préfixe
  (`stock.pdf.bak`) ni un objet portant le même nom dans un autre dossier ne
  satisfont la garde.
- Une erreur de lecture Storage est refusée explicitement (jamais traitée comme
  « objet présent ») : l'échec réseau ne doit pas ouvrir l'extraction.
- Tests : `src/lib/import/import-actions.test.ts` (describe
  `markImportDocumentUploaded` — objet présent / absent / préfixe / autre
  dossier / erreur Storage / rôle insuffisant / non authentifié / autre
  organisation / chemin invalide).

### 2.2 Extraction réservée à l'état `uploaded` (`extractImportDocument`)

L'extraction exige `state = 'uploaded'` **exactement** : ni `uploading`
(contenu encore modifiable, upload non abouti), ni `parsing`/`parsed`/
`extracting`/`extracted`/`failed`. La garde est placée **après** auth et rôle
(les contrôles d'accès restent prioritaires) mais **avant** le téléchargement
de l'objet et **avant** toute instanciation de provider : aucun octet lu,
aucun appel IA, aucun coût pour un document non éligible.

Tests : `src/lib/import/extract-action.test.ts` (describe « précondition d'état
'uploaded' » — refus `uploading`, refus paramétré des cinq autres états, succès
`uploaded`, priorité du contrôle d'organisation).

### 2.3 Scripts de vérification réversibles

`public.test_set_auth(uuid)` est `SECURITY DEFINER`. Laissé installé, il est
appelable par `PUBLIC` (défaut Postgres sur le schéma `public`) et permet
d'usurper n'importe quel `sub` via `request.jwt.claims` — **contournement de
RLS**. Les trois scripts `verify-*.sql` le créent ; les trois le créent
désormais **dans la transaction** ouverte en tête de script et annulée par le
`ROLLBACK` final : rien ne subsiste, y compris après une exécution en échec
(transaction avortée). Un `drop function if exists` inconditionnel puis une
assertion `to_regprocedure` ferment le cas d'un run antérieur déjà pollué.

`verify-rls.sql` avait en outre un défaut plus grave : il ne comportait
**aucun** `BEGIN`/`ROLLBACK` alors que son en-tête l'affirmait, et sa mutation
de test `update public.organizations set name = 'PIRATAGE'` était donc
persistée — une régression RLS aurait durablement corrompu un nom
d'organisation. Ce mutation est désormais encadrée par la transaction annulée.

Le helper utilise `set_config('request.jwt.claims', …, true)`, c'est-à-dire
`SET LOCAL` : le contexte d'impersonation est **transactionnel** et disparaît
au `ROLLBACK`. Il l'était initialement en `false` (`SET` sessionnel), ce qui
laissait un `sub` forgé dans la session de l'opérateur — y compris après un run
interrompu. Corollat : le helper n'a de sens qu'appelé **à l'intérieur** d'un
bloc de transaction ; hors transaction, `SET LOCAL` est sans effet et
l'impersonation échouerait silencieusement (faux positifs sur les tests RLS).

Preuve automatisée (aucune base locale dans ce dépôt) :
`src/lib/import/verify-scripts-cleanup.test.ts` verrouille l'enveloppe
transactionnelle des trois scripts, l'assertion de nettoyage, le drapeau
`SET LOCAL`, l'absence d'appel du helper hors transaction, — et pour
`verify-rls.sql` — que sa mutation de données est encadrée par la transaction
(`BEGIN` < mutation < `ROLLBACK`). Un second bloc vérifie que les trois scripts
déclarent un corps de helper **strictement identique** (le dernier script
exécuté ne doit pas dicter le comportement des suivants).

## 3. Métadonnées déclarées avant upload

`originalName`, `sourceKind`, `mimeType`, `sizeBytes` sont saisis **avant**
l'upload (`addImportDocument` crée la row en `uploading`, puis le navigateur
uploade directement vers Storage — la server action ne voit jamais les octets,
limite de corps 1 Mo face aux 25 Mo du bucket).

### Garanti côté client / serveur (zod `addImportDocumentSchema`)

- `originalName` : trim, 1–255 caractères, extension ∈ V1
  (PDF, DOC, DOCX, MD, JPG, JPEG, PNG, WEBP), `«/» et «\» neutralisés` dans le chemin.
- `sourceKind` : enum identique à la contrainte SQL (`pdf|docx|doc|md|image`).
- `mimeType` : non vide **et cohérent avec l'extension** (`importFileIssue` :
  extension ↔ MIME ↔ `sourceKind` doivent s'accorder).
- `sizeBytes` : entier 1 … 25 Mo ; `uploadImportDocument` rejette aussi
  `file.size > 25 Mo` avant tout appel réseau.
- Chemin : structure `organizations/{org}/imports/{session}/documents/{doc}/{file}`
  (UUID réels) validée par `importStoragePathSchema` ; la row est **créée avant**
  l'objet (policy INSERT l'exige) → pas d'objet orphelin à l'insertion.

### Garanti côté Storage

- `file_size_limit = 26214400` (25 Mo) du bucket `imports` : rejet serveur
  **indépendant** de la valeur déclarée `sizeBytes`.
- Nom/structure d'objet imposées par les policies (ids exacts, org owner/manager).
- `contentType` transmis par le navigateur (`file.type`) stocké en métadonnées
  d'objet : c'est une **déclaration du client**, pas une analyse d'octets.
- Contenu immuable après `uploading` (§ 2).

### À vérifier après upload (non garanti aujourd'hui)

- **Taille réelle vs `size_bytes`** : aucune réconciliation serveur n'est faite
  à ce jour ; seule la limite 25 Mo du bucket est opposée.
- **MIME réel du contenu vs `mimeType`** : Storage ne fait aucun sniffing ; la
  détection revient aux adaptateurs d'extraction (rejet des formats non supportés).
- **Contenu remplacé pendant la fenêtre `uploading`** : l'UPDATE de l'objet y est
  autorisé ; c'est le contrat, la fenêtre se referme au passage à `uploaded`
  (`markImportDocumentUploaded`) — transition désormais subordonnée à la
  présence réelle de l'objet (§ 2.1).
- **Upload annoncé mais absent** : faille désormais fermée —
  `markImportDocumentUploaded` refuse `uploaded` si l'objet n'existe pas (§ 2.1).
- `page_count`, `processed_at` : renseignés par l'extraction, jamais déclarés.

## 4. Limite de décompression documentaire (anti zip-bomb)

`IMPORT_MAX_FILE_BYTES` (25 Mo) borne le fichier **entrant**. Une entrée
compressée peut produire une sortie bien plus grande : une simple limite par
flux ne suffit pas, car un PDF contient plusieurs flux FlateDecode.

Une limite canonique et indépendante s'applique donc à la **sortie décompressée**,
par document :

| Constante | Valeur | Portée |
|---|---|---|
| `MAX_DECOMPRESSED_BYTES` | 32 MiB | budget **documentaire** unique, partagé par toutes les décompressions (PDF multi-flux, DOCX) |

- Budget créé **une fois par document** (`createDecompressionBudget()`), puis
  partagé par tous les flux : impossible de le contourner en cumulant.
- Chaque décompression reçoit au maximum le budget restant via
  `maxOutputLength` (Node zlib) : en cas de dépassement, **aucune sortie n'est
  produite** et le budget signale `DECOMPRESSION_BUDGET_EXCEEDED`.
- Après chaque décompression réussie, le budget est décrémenté des octets
  réellement produits.
- L'adaptateur produit une extraction **contrôlée/échouée**
  (`DECOMPRESSION_LIMIT_EXCEEDED`) : jamais d'allocation supplémentaire.
- Le fallback PDF utilise le **même** budget (jamais recréé, jamais
  redécompressé sans limite).

Aucune dépendance externe : `node:zlib` (`inflateSync` / `inflateRawSync`).

Tests : `src/lib/import/extraction/decompression.test.ts` (mécanisme) et
`src/lib/import/extraction/extractor.test.ts` (PDF bloqué, DOCX bloqué,
cumul multi-flux).

## 5. Limitations connues

1. Double panne à la suppression (§ 1) : orphelin possible, chemin exposé dans l'erreur.
2. Aucune réconciliation taille/MIME réel (§ 3).
3. `supabase/verify-import-storage.sql` est un script manuel (SQL Editor) :
   aucune stack locale n'est disponible dans ce dépôt (pas de Docker) → il n'est
   pas exécuté par `npm test`. Son équivalent automatique est
   `src/lib/import/storage-integrity.test.ts` (texte des policies verrouillé).
