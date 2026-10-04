// ---------------------------------------------------------------------------
// DOC (binaire OLE) — extraction best-effort des chaînes lisibles.
// ---------------------------------------------------------------------------

function asciiRuns(value: string): string[] {
  return value.match(/[\\x20-\\x7E]{4,}/g) ?? [];
}

function utf16Runs(bytes: Uint8Array): string[] {
  const runs: string[] = [];
  const text = Buffer.from(bytes).toString("utf16le");

  for (const run of text.match(/[\\x20-\\x7E]{4,}/g) ?? []) {
    if (!runs.includes(run)) runs.push(run);
  }

  return runs;
}

export function extractDocText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  const runs = [...asciiRuns(latin1), ...utf16Runs(bytes)];
  return [...new Set(runs)].join("\n");
}
