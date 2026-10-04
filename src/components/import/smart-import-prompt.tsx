"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, Images, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createAndUploadImportSession } from "@/lib/import/quick-import";

interface SmartImportPromptProps {
  returnTo: string;
  step?: number;
  ensureReady?: () => Promise<boolean> | boolean;
  compact?: boolean;
  title?: string;
  description?: string;
}

export function SmartImportPrompt({
  returnTo,
  step,
  ensureReady,
  compact = false,
  title = "Gagnez du temps avec l’import intelligent",
  description = "Déposez vos documents, ajoutez des photos ou prenez en photo vos registres. UNYVON prépare ensuite vos données pour vous.",
}: SmartImportPromptProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setBusy(true);
    setError("");
    try {
      if (ensureReady && !(await ensureReady())) return;
      const session = await createAndUploadImportSession(Array.from(fileList));
      const query = new URLSearchParams({
        session: session.id,
        returnTo,
        ...(step ? { step: String(step) } : {}),
      });
      router.push(`/import?${query.toString()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
      if (galleryInput.current) galleryInput.current.value = "";
    }
  };

  const openFiles = () => fileInput.current?.click();
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!busy) void upload(event.dataTransfer.files);
  };

  return (
    <section
      aria-label="Importer vos données"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={compact
        ? "rounded-[14px] border border-primary/20 bg-lavender-soft/40 p-4"
        : "rounded-[16px] border border-primary/20 bg-lavender-soft/40 p-5 sm:p-6"}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[12px] bg-surface flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-ink">{title}</h3>
          <p className="text-sm text-muted mt-1 leading-relaxed">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
        <Button
          type="button"
          variant="outline"
          className="justify-center"
          disabled={busy}
          onClick={openFiles}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
          Importer un fichier
        </Button>

        <Button
          type="button"
          variant="outline"
          className="justify-center"
          disabled={busy}
          onClick={() => cameraInput.current?.click()}
        >
          <Camera className="w-4 h-4" />
          Prendre une photo
        </Button>

        <Button
          type="button"
          variant="outline"
          className="justify-center"
          disabled={busy}
          onClick={() => galleryInput.current?.click()}
        >
          <Images className="w-4 h-4" />
          Choisir des photos
        </Button>
      </div>

      <div className="mt-3 rounded-[12px] border border-dashed border-primary/30 bg-surface/70 px-4 py-3 text-center">
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={openFiles}
        >
          ou glissez vos documents ici
        </button>
        <p className="text-xs text-muted mt-1">PDF, DOC/DOCX, JPG, PNG ou WEBP · 25 Mo maximum</p>
      </div>

      <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.doc,.docx,.md,.jpg,.jpeg,.png,.webp" multiple onChange={(event) => void upload(event.target.files)} aria-label="Importer des fichiers" />
      <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void upload(event.target.files)} aria-label="Prendre une photo" />
      <input ref={galleryInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void upload(event.target.files)} aria-label="Choisir des photos" />

      {error && <p role="alert" className="text-xs text-error mt-3">{error}</p>}
      {!compact && (
        <p className="text-xs text-muted mt-3">
          Vous pourrez toujours continuer manuellement. Aucune donnée métier n’est importée sans votre validation.
        </p>
      )}
    </section>
  );
}
