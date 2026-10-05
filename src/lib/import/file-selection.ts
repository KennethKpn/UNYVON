import { IMPORT_V1_FORMATS, type ImportSourceKind } from "./types";
import { importFileIssue } from "./schemas";

export type ImportFileResolution =
  | { ok: true; sourceKind: ImportSourceKind; mimeType: string }
  | { ok: false; error: string };

const MIME_ALIASES: Record<string, string[]> = {
  "image/png": ["image/x-png"],
  "image/jpeg": ["image/pjpeg"],
  "text/markdown": ["text/x-markdown"],
};

export function resolveImportFileType(
  originalName: string,
  browserMimeType: string
): ImportFileResolution {
  const ext = originalName.toLowerCase().split(".").pop() ?? "";
  const format = IMPORT_V1_FORMATS.find((candidate) => candidate.extension === ext);

  if (!format) {
    return {
      ok: false,
      error: originalName + ": format non supporté (PDF, DOC, DOCX, MD, JPG, JPEG, PNG ou WEBP).",
    };
  }

  const browserMime = browserMimeType.split(";")[0].trim().toLowerCase();
  const acceptedBrowserMimes = new Set([
    ...format.mimeTypes,
    ...format.mimeTypes.flatMap((mime) => MIME_ALIASES[mime] ?? []),
  ]);
  const mimeType =
    browserMime && acceptedBrowserMimes.has(browserMime)
      ? format.mimeTypes[0]
      : browserMime || format.mimeTypes[0];

  if (browserMime && !acceptedBrowserMimes.has(browserMime)) {
    return {
      ok: false,
      error: originalName + ": type MIME incompatible (" + browserMime + "). Le fichier n a pas été envoyé.",
    };
  }

  const sourceKind = format.sourceKinds[0];
  const issue = importFileIssue(originalName, mimeType, sourceKind);
  if (issue) return { ok: false, error: originalName + ": " + issue };

  return { ok: true, sourceKind, mimeType };
}
