"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FileUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useOrg } from "@/lib/context/org-context";
import {
  addImportDocument,
  cancelImportSession,
  createImportSession,
  getImportSessions,
  commitImportSession,
  decideImportItem,
  deleteImportDocument,
  finalizeImportReview,
  markImportDocumentUploaded,
  materializeImportDocument,
  matchImportSession,
  startImportProcessing,
} from "@/lib/supabase/import-actions";
import {
  getImportReviewData,
  retryImportDocument,
  type ImportReviewData,
} from "@/lib/supabase/import-review-actions";
import { uploadImportDocument } from "@/lib/import/storage-client";
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_V1_FORMATS,
  type ImportEntityType,
  type ImportItemAction,
  type ImportSourceKind,
  type DatabaseImportDocument,
  type DatabaseImportItem,
  type DatabaseImportSession,
} from "@/lib/import/types";
import { importFileIssue } from "@/lib/import/schemas";

const ACTIONS: Array<{ value: ImportItemAction; label: string }> = [
  { value: "create", label: "Créer" },
  { value: "use_existing", label: "Utiliser l'existant" },
  { value: "update", label: "Mettre à jour" },
  { value: "ignore", label: "Ignorer" },
];

const ENTITY_LABELS: Record<ImportEntityType, string> = {
  category: "Catégorie",
  product: "Produit",
  customer: "Client",
  supplier: "Fournisseur",
};

const SESSION_LABELS: Record<DatabaseImportSession["state"], string> = {
  collecting: "Collecte",
  processing: "Traitement",
  needs_review: "Revue",
  ready: "Prêt à importer",
  importing: "Importation",
  completed: "Terminé",
  failed: "Échec",
  cancelled: "Annulé",
};

const DOCUMENT_LABELS: Record<DatabaseImportDocument["state"], string> = {
  uploading: "Upload en cours",
  uploaded: "Prêt",
  parsing: "Lecture",
  parsed: "Lecture terminée",
  extracting: "Extraction",
  extracted: "Extrait",
  failed: "Échec",
};

function sourceKindFor(file: File): ImportSourceKind | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const format = IMPORT_V1_FORMATS.find((entry) => entry.extension === ext);
  if (!format) return null;
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (!format.mimeTypes.includes(mime)) return null;
  return format.sourceKinds[0] as never;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fieldsSummary(item: DatabaseImportItem): string {
  return Object.entries(item.fields)
    .map(([field, value]) => `${field}: ${value.raw}`)
    .join(" · ");
}

function stateBadgeVariant(
  state: DatabaseImportSession["state"]
): "success" | "warning" | "info" {
  if (state === "completed") return "success";
  if (state === "needs_review" || state === "ready") return "warning";
  return "info";
}

export default function ImportPage() {
  const router = useRouter();
  const { permissions } = useOrg();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<ImportReviewData | null>(null);
  const [sessions, setSessions] = useState<DatabaseImportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decisionDrafts, setDecisionDrafts] = useState<
    Record<string, { action: ImportItemAction; existingId: string | null }>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSession = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const next = await getImportReviewData(id);
      setData(next);
      setSessionId(id);
      setDecisionDrafts((current) => {
        const copy = { ...current };
        for (const item of next.items) {
          if (!copy[item.id]) {
            copy[item.id] = {
              action: item.status === "ignored" ? "ignore" : item.action,
              existingId: item.match?.existing_id ?? null,
            };
          }
        }
        return copy;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement de l'import");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {