// ---------------------------------------------------------------------------
// DOC (binaire OLE) — extraction best-effort des chaînes lisibles.
// ---------------------------------------------------------------------------

function asciiRuns(value: string): string[] {
  return value.match(/[\x20-\x7E]{4,}/g) ?? [];
}

function utf16LeRuns(bytes: Uint8Array): string[] {
  const runs: string[] = [];

  // Les anciens .doc peuvent stocker du texte en UTF-16LE. On ne décode que
  // les séquences où chaque caractère ASCII est suivi de 0x00 afin d'éviter
  // de transformer les métadonnées binaires OLE en faux texte.
  for (const offset of [0, 1]) {
    let current = "";

    for (let i = offset; i + 1 < bytes.length; i += 2) {
      const low = bytes[i];
      const high = bytes[i + 1];

      if (high === 0 && low >= 0x20 && low <= 0x7e) {
        current += String.fromCharCode(low);
        continue;
      }

      if (current.length >= 4) runs.push(current);
      current = "";
    }

    if (current.length >= 4) runs.push(current);
  }

  return [...new Set(runs)];
}

export function extractDocText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const ascii = asciiRuns(buffer.toString("latin1"));
  const utf16 = utf16LeRuns(bytes);

  return [...new Set([...ascii, ...utf16])].join("\n");
}
