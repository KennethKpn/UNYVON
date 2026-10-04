"use client";

import { useRef } from "react";
import { Camera, FileUp, Images, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SmartImportPromptProps {
  onStartImport: (source?: "files" | "camera" | "gallery") => void | Promise<void>;
  compact?: boolean;
  title?: string;
  description?: string;
}

export function SmartImportPrompt({
  onStartImport,
  compact = false,
  title = "Gagnez du temps avec l’import intelligent",
  description = "Déposez vos documents, ajoutez des photos ou prenez en photo vos registres. UNYVON prépare ensuite vos données pour vous.",
}: SmartImportPromptProps) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const start = async (source: "files" | "camera" | "gallery") => {
    await onStartImport(source);
  };

  return (
    <section
      aria-label="Importer vos données"
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
          onClick={() => void start("files")}
        >
          <FileUp className="w-4 h-4" />
          Importer un fichier
        </Button>

        <Button
          type="button"
          variant="outline"
          className="justify-center"
          onClick={() => cameraInput.current?.click()}
        >
          <Camera className="w-4 h-4" />
          Prendre une photo
        </Button>

        <Button
          type="button"
          variant="outline"
          className="justify-center"
          onClick={() => galleryInput.current?.click()}
        >
          <Images className="w-4 h-4" />
          Choisir des photos
        </Button>
      </div>

      <input
        ref={galleryInput}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={() => void start("gallery")}
        aria-label="Choisir des photos"
      />
      <input
        ref={cameraInput}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={() => void start("camera")}
        aria-label="Prendre une photo"
      />

      {!compact && (
        <p className="text-xs text-muted mt-3">
          Vous pourrez toujours continuer manuellement. Aucune donnée métier n’est importée sans votre validation.
        </p>
      )}
    </section>
  );
}
