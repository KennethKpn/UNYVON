import { z } from "zod";
import {
  IMPORT_DOCUMENT_STATES,
  IMPORT_ENTITY_TYPES,
  IMPORT_FIELD_CONFIDENCES,
  IMPORT_ITEM_ACTIONS,
  IMPORT_ITEM_STATUSES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_SESSION_STATES,
  IMPORT_SOURCE_KINDS,
  IMPORT_TARGET_FIELDS,
  IMPORT_V1_FORMATS,
  type ImportDocumentState,
  type ImportEntityType,
  type ImportItemStatus,
  type ImportSessionState,
} from "./types";

// ---------------------------------------------------------------------------
// Enums — miroir exact des types SQL de 0011_import.sql
// ---------------------------------------------------------------------------

export const uuidSchema = z.uuid();

export const importSessionStateSchema = z.enum(IMPORT_SESSION_STATES);
export const importDocumentStateSchema = z.enum(IMPORT_DOCUMENT_STATES);
export const importSourceKindSchema = z.enum(IMPORT_SOURCE_KINDS);
export const importEntityTypeSchema = z.enum(IMPORT_ENTITY_TYPES);
export const importItemActionSchema = z.enum(IMPORT_ITEM_ACTIONS);
export const importItemStatusSchema = z.enum(IMPORT_ITEM_STATUSES);
export const importFieldConfidenceSchema = z.enum(IMPORT_FIELD_CONFIDENCES);

// ---------------------------------------------------------------------------
// Provenance par champ + rapprochement (jsonb import_items)
// ---------------------------------------------------------------------------

export const importFieldProvenanceSchema = z.strictObject({
  raw: z.string(),
  normalized: z.union([z.string(), z.number(), z.null()]).optional(),
  confidence: importFieldConfidenceSchema,
  warning: z.string().nullable().optional(),
  page: z.number().int().min(1).nullable().optional(),
});

export const importItemMatchSchema = z.strictObject({
  existing_id: uuidSchema.nullable(),
  existing_name: z.string().nullable(),
  score: z.number().min(0).max(1),
  reason: z.string().nullable().optional(),
});

// Champs valides = IMPORT_TARGET_FIELDS[entityType] (jamais d'invention).
// Le champ `name` est requis : import_commit ne peut pas créer d'entité sans.
// Exporté pour la validation de la sortie d'extraction (Phase 4).
export function importFieldsSchema(entityType: ImportEntityType) {
  return z
    .partialRecord(
      z.enum(IMPORT_TARGET_FIELDS[entityType]),
      importFieldProvenanceSchema
    )
    .refine((fields) => fields !== null && "name" in fields, {
      message: "Le champ name est obligatoire",
    });
}

// ---------------------------------------------------------------------------
// Entrées des server actions du pipeline d'import
// ---------------------------------------------------------------------------

export const addImportDocumentSchema = z
  .strictObject({
    sessionId: uuidSchema,
    originalName: z.string().trim().min(1).max(255),
    sourceKind: importSourceKindSchema,
    mimeType: z.string().trim().min(1),
    sizeBytes: z.number().int().min(1).max(IMPORT_MAX_FILE_BYTES),
  })
  .superRefine((value, ctx) => {
    const issue = importFileIssue(
      value.originalName,
      value.mimeType,
      value.sourceKind
    );
    if (issue !== null) {
      ctx.addIssue({ code: "custom", message: issue });
    }
  });

const importItemCommon = {
  sessionId: uuidSchema,
  documentId: uuidSchema,
  sourcePage: z.number().int().min(1).nullable().optional(),
  match: importItemMatchSchema.nullable().optional(),
};

export const importItemInputSchema = z.discriminatedUnion("entityType", [
  z.strictObject({
    ...importItemCommon,
    entityType: z.literal("category"),
    fields: importFieldsSchema("category"),
  }),
  z.strictObject({
    ...importItemCommon,
    entityType: z.literal("product"),
    fields: importFieldsSchema("product"),
  }),
  z.strictObject({
    ...importItemCommon,
    entityType: z.literal("customer"),
    fields: importFieldsSchema("customer"),
  }),
  z.strictObject({
    ...importItemCommon,
    entityType: z.literal("supplier"),
    fields: importFieldsSchema("supplier"),
  }),
]);

export function importEditedFieldsSchema(
  entityType: import("./types").ImportEntityType,
  fields: unknown
) {
  return importFieldsSchema(entityType).safeParse(fields);
}

// Une modification manuelle ne peut changer que les valeurs extraites.
// Les informations de provenance (confidence/page) restent attachées au champ,
// tandis que normalized est recalculé/abandonné au commit si nécessaire.
export const updateImportItemSchema = z
  .strictObject({
    id: uuidSchema,
    action: importItemActionSchema.optional(),
    status: importItemStatusSchema.optional(),
  })
  .refine((value) => value.action !== undefined || value.status !== undefined, {
    message: "Au moins une action ou un statut est requis",
  });

// ---------------------------------------------------------------------------
// Chemin Storage — structure imposée par les policies de 0011_import.sql :
// organizations/{orgId}/imports/{sessionId}/documents/{documentId}/{fileName}
// ---------------------------------------------------------------------------

// Structure exacte imposée par les policies storage_import_*_id (0011) :
// chaque segment de chemin doit être un uuid réel, pas 36 caractères libres.
const UUID_PATTERN =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const STORAGE_PATH_PATTERN = new RegExp(
  `^organizations/${UUID_PATTERN}/imports/${UUID_PATTERN}/documents/${UUID_PATTERN}/[^/]+$`
);

export const importStoragePathSchema = z
  .string()
  .regex(STORAGE_PATH_PATTERN, "Chemin de stockage invalide");

// ---------------------------------------------------------------------------
// Formats V1 : extension ↔ MIME ↔ source_kind doivent être cohérents
// ---------------------------------------------------------------------------

export function importFileIssue(
  originalName: string,
  mimeType: string,
  sourceKind: string
): string | null {
  const ext = originalName.toLowerCase().split(".").pop() ?? "";
  const format = IMPORT_V1_FORMATS.find((f) => f.extension === ext);
  if (!format) {
    return "Format de fichier non supporté (V1 : PDF, DOC, DOCX, MD, JPG, JPEG, PNG, WEBP)";
  }
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const mimeTypes: readonly string[] = format.mimeTypes;
  if (!mimeTypes.includes(mime)) {
    return "Le type MIME ne correspond pas à l'extension du fichier";
  }
  const sourceKinds: readonly string[] = format.sourceKinds;
  if (!sourceKinds.includes(sourceKind)) {
    return "Le type de source ne correspond pas à l'extension du fichier";
  }
  return null;
}

export function sanitizeImportStorageFileName(fileName: string): string {
  const extension = fileName.includes(".")
    ? `.${fileName.split(".").pop()!.toLowerCase()}`
    : "";
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;

  const normalized = stem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

  const safeStem = (normalized || "document").slice(0, 180);
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
  return safeStem + safeExtension;
}

export function buildImportStoragePath(
  organizationId: string,
  sessionId: string,
  documentId: string,
  fileName: string
): string {
  const safeName = sanitizeImportStorageFileName(fileName);
  return `organizations/${organizationId}/imports/${sessionId}/documents/${documentId}/${safeName}`;
}

// ---------------------------------------------------------------------------
// Transitions d'état — règles du pipeline (collecte → extraction → review →
// commit → terminé). Toute transition hors graphe est rejetée côté serveur.
// ---------------------------------------------------------------------------

export const IMPORT_SESSION_TRANSITIONS: Record<
  ImportSessionState,
  readonly ImportSessionState[]
> = {
  collecting: ["processing", "failed", "cancelled"],
  processing: ["needs_review", "failed", "cancelled"],
  needs_review: ["ready", "processing", "failed", "cancelled"],
  ready: ["importing", "needs_review", "cancelled"],
  importing: ["completed", "failed"],
  completed: [],
  failed: ["collecting", "cancelled"],
  cancelled: [],
};

export const IMPORT_DOCUMENT_TRANSITIONS: Record<
  ImportDocumentState,
  readonly ImportDocumentState[]
> = {
  uploading: ["uploaded", "failed"],
  uploaded: ["parsing", "failed"],
  parsing: ["parsed", "failed"],
  parsed: ["extracting", "failed"],
  extracting: ["extracted", "failed"],
  extracted: [],
  failed: ["uploading", "parsing"],
};

export const IMPORT_ITEM_STATUS_TRANSITIONS: Record<
  ImportItemStatus,
  readonly ImportItemStatus[]
> = {
  pending: ["validated", "ignored", "failed"],
  validated: ["pending", "ignored", "imported", "failed"],
  ignored: ["pending", "validated"],
  imported: [],
  failed: ["pending", "validated", "ignored"],
};

export function canTransitionImportSession(
  from: ImportSessionState,
  to: ImportSessionState
): boolean {
  return IMPORT_SESSION_TRANSITIONS[from].includes(to);
}

export function canTransitionImportDocument(
  from: ImportDocumentState,
  to: ImportDocumentState
): boolean {
  return IMPORT_DOCUMENT_TRANSITIONS[from].includes(to);
}

export function canTransitionImportItemStatus(
  from: ImportItemStatus,
  to: ImportItemStatus
): boolean {
  return IMPORT_ITEM_STATUS_TRANSITIONS[from].includes(to);
}
