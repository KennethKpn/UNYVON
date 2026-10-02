// ---------------------------------------------------------------------------
// DOC (binaire OLE) — extraction best-effort des chaînes ASCII lisibles.
// Aucune information absente du document n'est affirmée.
// ---------------------------------------------------------------------------

export function extractDocText(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString("latin1");
  const runs = text.match(/[\x20-\x7E]{5,}/g) ?? [];
  return runs.join("\n");
}
