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

function sourceKindFor(file: File): `
  | "pdf"
  | "doc"
  | "docx"
  | "md"
  | "image"
` | null {
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
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("session");
        const rows = await getImportSessions();
        if (cancelled) return;
        setSessions(rows);
        if (requested) {
          await loadSession(requested);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
          setLoading(false);
        }
      } finally {
        if (!cancelled && !new URLSearchParams(window.location.search).get("session")) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDocs = data?.documents.filter((doc) => doc.state !== "failed") ?? [];
  const failedDocs = data?.documents.filter((doc) => doc.state === "failed") ?? [];
  const pendingItems = data?.items.filter((item) => item.status === "pending") ?? [];
  const undecidedCount = pendingItems.length;
  const validatedCount =
    data?.items.filter((item) => item.status === "validated").length ?? 0;
  const ignoredCount =
    data?.items.filter((item) => item.status === "ignored").length ?? 0;

  const readyForReview =
    !!data &&
    data.session.state === "needs_review" &&
    data.items.length > 0 &&
    undecidedCount === 0;

  const hasRemainingDocuments = !!data?.documents.some(
    (doc) => doc.state === "uploaded"
  );

  const canProcess =
    !!data &&
    ["collecting", "processing", "needs_review"].includes(data.session.state) &&
    (hasRemainingDocuments ||
      (data.session.state === "collecting" && data.documents.length > 0));

  const canFinalize =
    !!data &&
    data.session.state === "needs_review" &&
    data.items.length > 0 &&
    undecidedCount === 0;

  const canCommit = data?.session.state === "ready";

  const sessionProgress = useMemo(() => {
    if (!data) return 0;
    if (data.session.state === "collecting") return 20;
    if (data.session.state === "processing") return 45;
    if (data.session.state === "needs_review") return 70;
    if (data.session.state === "ready") return 90;
    if (data.session.state === "completed") return 100;
    return 0;
  }, [data]);

  const setUrlSession = (id: string | null) => {
    const next = id ? `/import?session=${encodeURIComponent(id)}` : "/import";
    router.replace(next);
  };

  const handleNewSession = async () => {
    setBusy("new");
    setError("");
    setNotice("");
    try {
      const session = await createImportSession();
      setSessions((current) => [session, ...current]);
      setSessionId(session.id);
      setData({
        session,
        documents: [],
        items: [],
        options: { category: [], product: [], customer: [], supplier: [] },
      });
      setDecisionDrafts({});
      setUrlSession(session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de créer l'import");
    } finally {
      setBusy("");
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !sessionId || !data) return;
    const selected = Array.from(files);
    setBusy("upload");
    setError("");
    setNotice("");

    try {
      for (const file of selected) {
        const sourceKind = sourceKindFor(file);
        const issue = sourceKind
          ? importFileIssue(file.name, file.type, sourceKind)
          : "Format de fichier non supporté (V1 : PDF, DOC, DOCX, MD, JPG, JPEG, PNG, WEBP)";
        if (issue) throw new Error(issue);
        if (file.size === 0) throw new Error(`Le fichier ${file.name} est vide`);
        if (file.size > IMPORT_MAX_FILE_BYTES) {
          throw new Error(`Le fichier ${file.name} dépasse 25 Mo`);
        }

        const created = await addImportDocument({
          sessionId,
          originalName: file.name,
          sourceKind: sourceKind as NonNullable<ReturnType<typeof sourceKindFor>>,
          mimeType: file.type,
          sizeBytes: file.size,
        });

        try {
          await uploadImportDocument(file, created.storagePath);
          await markImportDocumentUploaded(created.document.id);
        } catch (uploadError) {
          try {
            await deleteImportDocument(created.document.id);
          } catch {
            // L'erreur initiale reste prioritaire. Le serveur expose le chemin
            // en cas d'orphelin potentiel et permet une reprise manuelle.
          }
          throw uploadError;
        }
      }

      setNotice(
        selected.length > 1
          ? `${selected.length} documents ajoutés avec succès.`
          : "Document ajouté avec succès."
      );
      await loadSession(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur upload document");
      await loadSession(sessionId);
    } finally {
      setBusy("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!sessionId) return;
    setBusy(`delete:${documentId}`);
    setError("");
    try {
      await deleteImportDocument(documentId);
      setNotice("Document supprimé.");
      await loadSession(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression document");
    } finally {
      setBusy("");
    }
  };

  const handleRetryDocument = async (documentId: string) => {
    if (!sessionId) return;
    setBusy(`retry:${documentId}`);
    setError("");
    try {
      await retryImportDocument(documentId);
      setNotice("Document remis en traitement.");
      await loadSession(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de relancer le document");
    } finally {
      setBusy("");
    }
  };

  const handleProcess = async () => {
    if (!data || !sessionId) return;
    setBusy("process");
    setError("");
    setNotice("");
    try {
      if (data.session.state === "collecting") {
        await startImportProcessing(sessionId);
      }

      let refreshed = await getImportReviewData(sessionId);
      for (const doc of refreshed.documents) {
        if (doc.state !== "uploaded") continue;
        const items = await materializeImportDocument(doc.id);
        refreshed = {
          ...refreshed,
          items: [
            ...refreshed.items.filter((item) => item.document_id !== doc.id),
            ...items,
          ],
        };
        setData(refreshed);
      }

      refreshed = await getImportReviewData(sessionId);
      if (refreshed.session.state === "needs_review") {
        const matched = await matchImportSession(sessionId);
        refreshed = { ...refreshed, items: matched };
      }

      setData(refreshed);
      setSessions((current) =>
        current.map((session) =>
          session.id === refreshed.session.id ? refreshed.session : session
        )
      );
      setNotice("Traitement terminé : la revue des données est prête.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur pendant le traitement");
      await loadSession(sessionId);
    } finally {
      setBusy("");
    }
  };

  const handleDecision = async (item: DatabaseImportItem) => {
    const draft = decisionDrafts[item.id];
    if (!draft) return;
    setBusy(`decision:${item.id}`);
    setError("");
    try {
      const updated = await decideImportItem({
        id: item.id,
        action: draft.action,
        existingId:
          draft.action === "use_existing" || draft.action === "update"
            ? draft.existingId
            : null,
      });
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.id === updated.id ? updated : entry
              ),
            }
          : current
      );
      setNotice("Décision enregistrée.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur enregistrement décision");
    } finally {
      setBusy("");
    }
  };

  const handleFinalize = async () => {
    if (!sessionId) return;
    setBusy("finalize");
    setError("");
    try {
      const session = await finalizeImportReview(sessionId);
      setData((current) => (current ? { ...current, session } : current));
      setSessions((current) =>
        current.map((entry) => (entry.id === session.id ? session : entry))
      );
      setNotice("Revue finalisée. Rien n'est encore écrit dans les tables métier.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de finaliser la revue");
    } finally {
      setBusy("");
    }
  };

  const handleCommit = async () => {
    if (!sessionId) return;
    if (
      !window.confirm(
        "La validation finale va créer ou mettre à jour les catégories, produits, clients et fournisseurs sélectionnés. Continuer ?"
      )
    ) {
      return;
    }
    setBusy("commit");
    setError("");
    try {
      const session = await commitImportSession(sessionId);
      setData((current) => (current ? { ...current, session } : current));
      setSessions((current) =>
        current.map((entry) => (entry.id === session.id ? session : entry))
      );
      setNotice(
        "Import terminé. Les opérations ont été appliquées atomiquement par la base."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur commit de l'import");
      await loadSession(sessionId);
    } finally {
      setBusy("");
    }
  };

  const handleCancel = async () => {
    if (!sessionId) return;
    setBusy("cancel");
    setError("");
    try {
      const session = await cancelImportSession(sessionId);
      setData((current) => (current ? { ...current, session } : current));
      setSessions((current) =>
        current.map((entry) => (entry.id === session.id ? session : entry))
      );
      setNotice("Import annulé.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur annulation");
    } finally {
      setBusy("");
    }
  };

  if (!permissions?.canManageOrganization) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card variant="elevated">
          <CardContent className="py-12 text-center">
            <ShieldCheck className="w-10 h-10 mx-auto text-muted mb-4" />
            <h1 className="font-display text-2xl font-bold text-ink">
              Import intelligent
            </h1>
            <p className="mt-2 text-sm text-muted">
              Cette fonction est réservée aux propriétaires et managers.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted mb-2">
            <span>UNYVON</span>
            <span>/</span>
            <span>Import intelligent</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">
            Import intelligent
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Déposez vos fichiers, laissez le moteur proposer une structuration et un
            rapprochement, puis gardez le contrôle avant toute écriture métier.
          </p>
        </div>

        {!data ? (
          <Button onClick={handleNewSession} disabled={busy !== ""}>
            {busy === "new" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
            Nouvel import
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setData(null);
                setSessionId(null);
                setUrlSession(null);
              }}
              disabled={busy !== ""}
            >
              <ChevronLeft className="w-4 h-4" />
              Imports
            </Button>
          </div>
        )}
      </div>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={
            error
              ? "flex items-start gap-2 p-3 rounded-[10px] bg-error/10 border border-error/20 text-sm text-error"
              : "flex items-start gap-2 p-3 rounded-[10px] bg-success/10 border border-success/20 text-sm text-success"
          }
        >
          {error ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{error || notice}</span>
          <button
            type="button"
            aria-label="Fermer le message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
            className="p-1 rounded-[6px] hover:bg-black/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!data ? (
        <div className="space-y-4">
          <Card variant="elevated">
            <CardContent className="py-10">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-[12px] bg-lavender-soft/70">
                  <Upload className="w-5 h-5 text-primary mb-3" />
                  <h2 className="font-display font-semibold text-ink">1. Déposer</h2>
                  <p className="text-xs text-muted mt-1">
                    PDF, DOC, DOCX, Markdown ou image, jusqu'à 25 Mo par fichier.
                  </p>
                </div>
                <div className="p-4 rounded-[12px] bg-background">
                  <Wand2 className="w-5 h-5 text-primary mb-3" />
                  <h2 className="font-display font-semibold text-ink">2. Contrôler</h2>
                  <p className="text-xs text-muted mt-1">
                    L'extraction et le matching restent des propositions, jamais une
                    écriture automatique.
                  </p>
                </div>
                <div className="p-4 rounded-[12px] bg-background">
                  <ShieldCheck className="w-5 h-5 text-success mb-3" />
                  <h2 className="font-display font-semibold text-ink">3. Valider</h2>
                  <p className="text-xs text-muted mt-1">
                    Le commit final est atomique et revalide ses cibles côté base.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card variant="elevated">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display font-semibold text-ink">Imports récents</h2>
                  <p className="text-xs text-muted mt-1">
                    Reprenez un traitement en cours sans recréer de session.
                  </p>
                </div>
                <Badge variant="info">{sessions.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">
                  Aucun import enregistré.
                </p>
              ) : (
                <div className="space-y-2">
                  {sessions.slice(0, 12).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => {
                        setUrlSession(session.id);
                        void loadSession(session.id);
                      }}
                      className="w-full flex items-center gap-3 p-3 min-h-[56px] rounded-[12px] border border-border hover:bg-background text-left"
                    >
                      <div className="w-9 h-9 rounded-[10px] bg-lavender-soft flex items-center justify-center shrink-0">
                        <FileUp className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink">
                          Import · {session.id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(session.created_at)}
                        </p>
                      </div>
                      <Badge variant={stateBadgeVariant(session.state)}>
                        {SESSION_LABELS[session.state]}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <Card variant="elevated">
            <CardContent className="py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={stateBadgeVariant(data.session.state)}>
                      {SESSION_LABELS[data.session.state]}
                    </Badge>
                    <span className="text-xs text-muted">
                      #{data.session.id.slice(0, 8)}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-2">
                    {data.documents.length} document(s) · {data.items.length} élément(s)
                  </p>
                </div>
                <div className="w-full sm:w-64">
                  <div className="flex justify-between text-[11px] text-muted mb-1">
                    <span>Progression</span>
                    <span>{sessionProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${sessionProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
            <Card variant="elevated">
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display font-semibold text-ink">Documents</h2>
                    <p className="text-xs text-muted mt-1">
                      L'upload est direct vers Storage ; aucun fichier n'est envoyé au
                      serveur d'action.
                    </p>
                  </div>
                  {data.session.state === "collecting" && (
                    <Button
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy !== ""}
                    >
                      {busy === "upload" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Ajouter
                    </Button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.md,.jpg,.jpeg,.png,.webp"
                    onChange={(event) => void handleFiles(event.target.files)}
                    aria-label="Sélectionner des documents à importer"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.documents.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border p-8 text-center">
                    <FileUp className="w-8 h-8 mx-auto text-muted mb-3" />
                    <p className="text-sm font-medium text-ink">Aucun document</p>
                    <p className="text-xs text-muted mt-1">
                      Ajoutez au moins un fichier pour démarrer le traitement.
                    </p>
                  </div>
                ) : (
                  data.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="rounded-[12px] border border-border p-3 space-y-2"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-[10px] bg-lavender-soft flex items-center justify-center shrink-0">
                          <FileUp className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink truncate">
                            {doc.original_name}
                          </p>
                          <p className="text-xs text-muted">
                            {doc.source_kind.toUpperCase()} · {formatBytes(doc.size_bytes)}
                          </p>
                        </div>
                        <Badge
                          variant={
                            doc.state === "extracted" || doc.state === "uploaded"
                              ? "success"
                              : doc.state === "failed"
                                ? "warning"
                                : "info"
                          }
                        >
                          {DOCUMENT_LABELS[doc.state]}
                        </Badge>
                      </div>

                      {doc.error_message && (
                        <div className="text-xs text-error bg-error/5 rounded-[8px] p-2">
                          {doc.error_message}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {doc.state === "failed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRetryDocument(doc.id)}
                            disabled={busy !== ""}
                          >
                            {busy === `retry:${doc.id}` ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                            Relancer
                          </Button>
                        )}

                        {["uploading", "uploaded", "failed"].includes(doc.state) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteDocument(doc.id)}
                            disabled={busy !== ""}
                          >
                            {busy === `delete:${doc.id}` ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Supprimer
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {data.documents.length > 0 &&
                  data.session.state === "collecting" && (
                    <Button
                      className="w-full"
                      onClick={() => void handleProcess()}
                      disabled={busy !== "" || data.documents.some((doc) => doc.state === "uploading")}
                    >
                      {busy === "process" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4" />
                      )}
                      Lancer l'extraction et le matching
                    </Button>
                  )}

                {canProcess &&
                  data.session.state !== "collecting" &&
                  data.documents.some((doc) => doc.state === "uploaded") && (
                    <Button
                      className="w-full"
                      onClick={() => void handleProcess()}
                      disabled={busy !== ""}
                    >
                      {busy === "process" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Reprendre le traitement
                    </Button>
                  )}

                {failedDocs.length > 0 && (
                  <p className="text-xs text-warning">
                    {failedDocs.length} document(s) sont en échec. Relancez-les ou
                    annulez cette session avant de recommencer.
                  </p>
                )}

                {activeDocs.length === 0 && data.session.state !== "collecting" && (
                  <p className="text-xs text-muted">
                    Aucun document exploitable dans cette session.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card variant="elevated">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display font-semibold text-ink">
                      Revue des données
                    </h2>
                    <p className="text-xs text-muted mt-1">
                      Chaque décision est enregistrée séparément avant le commit final.
                    </p>
                  </div>
                  {data.items.length > 0 && (
                    <div className="flex gap-2 text-[11px] text-muted">
                      <span>{validatedCount} validé(s)</span>
                      <span>·</span>
                      <span>{ignoredCount} ignoré(s)</span>
                      <span>·</span>
                      <span>{undecidedCount} à traiter</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {data.items.length === 0 ? (
                  <div className="py-10 text-center">
                    <Wand2 className="w-7 h-7 mx-auto text-muted mb-3" />
                    <p className="text-sm text-muted">
                      Les éléments extraits apparaîtront ici après le traitement.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {data.items.map((item) => {
                      const draft = decisionDrafts[item.id] ?? {
                        action: item.action,
                        existingId: item.match?.existing_id ?? null,
                      };
                      const options = data.options[item.entity_type] ?? [];
                      const selectedExisting =
                        options.find((option) => option.id === draft.existingId) ?? null;
                      return (
                        <div
                          key={item.id}
                          className="rounded-[12px] border border-border p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="info">
                                  {ENTITY_LABELS[item.entity_type]}
                                </Badge>
                                <Badge
                                  variant={
                                    item.status === "validated" || item.status === "ignored"
                                      ? "success"
                                      : "warning"
                                  }
                                >
                                  {item.status}
                                </Badge>
                                {item.source_page && (
                                  <span className="text-[11px] text-muted">
                                    page {item.source_page}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-ink mt-2">
                                {item.fields.name?.raw ?? "Nom absent"}
                              </p>
                              <p className="text-xs text-muted mt-1 break-words">
                                {fieldsSummary(item)}
                              </p>
                            </div>
                            {item.match?.existing_name && (
                              <div className="text-right">
                                <p className="text-[11px] text-muted">Proposition</p>
                                <p className="text-xs font-medium text-ink">
                                  {item.match.existing_name}
                                </p>
                                <p className="text-[11px] text-muted">
                                  {Math.round(item.match.score * 100)} % · {item.match.reason}
                                </p>
                              </div>
                            )}
                          </div>

                          {Object.entries(item.fields).some(
                            ([, field]) => field.warning || field.confidence !== "high"
                          ) && (
                            <div className="rounded-[8px] bg-warning/10 p-2 text-xs text-warning">
                              Certaines valeurs demandent une vérification manuelle avant
                              validation.
                            </div>
                          )}

                          {data.session.state === "needs_review" && item.status !== "imported" && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {ACTIONS.map((action) => (
                                  <button
                                    key={action.value}
                                    type="button"
                                    className={
                                      draft.action === action.value
                                        ? "min-h-[44px] rounded-[10px] border border-primary bg-lavender-soft text-primary text-xs font-medium"
                                        : "min-h-[44px] rounded-[10px] border border-border bg-surface text-muted text-xs font-medium hover:bg-background"
                                    }
                                    onClick={() =>
                                      setDecisionDrafts((current) => ({
                                        ...current,
                                        [item.id]: {
                                          action: action.value,
                                          existingId:
                                            action.value === "use_existing" ||
                                            action.value === "update"
                                              ? current[item.id]?.existingId ??
                                                item.match?.existing_id ??
                                                null
                                              : null,
                                        },
                                      }))
                                    }
                                  >
                                    {action.label}
                                  </button>
                                ))}
                              </div>

                              {(draft.action === "use_existing" || draft.action === "update") && (
                                <div>
                                  <label
                                    htmlFor={`existing-${item.id}`}
                                    className="block text-xs font-medium text-text mb-1"
                                  >
                                    Cible existante
                                  </label>
                                  <select
                                    id={`existing-${item.id}`}
                                    value={draft.existingId ?? ""}
                                    onChange={(event) =>
                                      setDecisionDrafts((current) => ({
                                        ...current,
                                        [item.id]: {
                                          ...current[item.id],
                                          existingId: event.target.value || null,
                                        },
                                      }))
                                    }
                                    className="w-full min-h-[44px] rounded-[10px] border border-border bg-surface px-3 text-sm text-text"
                                  >
                                    <option value="">Sélectionner une cible…</option>
                                    {options.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.name}
                                        {selectedExisting?.id === option.id ? " · proposé" : ""}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {draft.action === "use_existing" &&
                                item.match?.existing_id &&
                                draft.existingId !== item.match.existing_id && (
                                  <p className="text-[11px] text-muted">
                                    La proposition automatique n'est pas imposée. Vous
                                    pouvez sélectionner une autre entité.
                                  </p>
                                )}

                              <Button
                                size="sm"
                                onClick={() => void handleDecision(item)}
                                disabled={
                                  busy !== "" ||
                                  ((draft.action === "use_existing" || draft.action === "update") &&
                                    !draft.existingId)
                                }
                              >
                                {busy === `decision:${item.id}` ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4" />
                                )}
                                Enregistrer la décision
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {canFinalize && (
                      <Button
                        className="w-full"
                        onClick={() => void handleFinalize()}
                        disabled={busy !== "" || !readyForReview}
                      >
                        {busy === "finalize" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                        Finaliser la revue
                      </Button>
                    )}

                    {canCommit && (
                      <div className="rounded-[12px] bg-lavender-soft/70 border border-primary/15 p-4">
                        <p className="text-sm font-medium text-ink">
                          Revue verrouillée, prêt pour le commit
                        </p>
                        <p className="text-xs text-muted mt-1">
                          La base revalidera les cibles, l'organisation et les champs
                          avant toute écriture métier.
                        </p>
                        <Button
                          className="w-full mt-3"
                          onClick={() => void handleCommit()}
                          disabled={busy !== ""}
                        >
                          {busy === "commit" ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                          Importer définitivement
                        </Button>
                      </div>
                    )}

                    {data.session.state === "completed" && (
                      <div className="rounded-[12px] bg-success/10 border border-success/20 p-4 text-sm text-success flex items-start gap-2">
                        <CheckCircle2 className="w-5 h-5 shrink-0" />
                        <div>
                          <p className="font-medium">Import terminé</p>
                          <p className="text-xs mt-1">
                            Les décisions validées ont été appliquées.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Les suggestions de matching restent non contraignantes jusqu'à votre
              validation explicite.
            </p>
            {!["completed", "cancelled", "importing"].includes(data.session.state) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCancel()}
                disabled={busy !== ""}
              >
                Annuler l'import
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
