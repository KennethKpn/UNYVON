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
verrouillée : dernière migration créant chaque policy) et
`supabase/verify-import-storage.sql` § 1 (catalogue) + § 2 (aller-retour).

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
  (`markImportDocumentUploaded`).
- `page_count`, `processed_at` : renseignés par l'extraction, jamais déclarés.

## 4. Limitations connues

1. Double panne à la suppression (§ 1) : orphelin possible, chemin exposé dans l'erreur.
2. Aucune réconciliation taille/MIME réel (§ 3).
3. `supabase/verify-import-storage.sql` est un script manuel (SQL Editor) :
   aucune stack locale n'est disponible dans ce dépôt (pas de Docker) → il n'est
   pas exécuté par `npm test`. Son équivalent automatique est
   `src/lib/import/storage-integrity.test.ts` (texte des policies verrouillé).
