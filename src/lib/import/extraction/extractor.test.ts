  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 4 0 R >> endobj",
    [
      "4 0 obj << /Length 0 >> stream",
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "begincodespacerange",
      "<00> <FF>",
      "endcodespacerange",
      "beginbfchar",
      "<01> <0050>",
      "<02> <00E9>",
      "<03> <0072>",
      "<04> <006F>",
      "<05> <0075>",
      "endbfchar",
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
      "endstream endobj",
    ].join("\n"),
    "5 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 6 0 R >> endobj",
    "6 0 obj << /Length 0 >> stream\nBT /F1 12 Tf <0102030405> Tj ET\nendstream endobj",
  ];

  return new Uint8Array(Buffer.from("%PDF-1.4\n" + objects.map((obj) => obj + "\n").join(""), "latin1"));
}

function makePdfBytes(pages: string[], compress = false): Uint8Array {
  const enc = (s: string) => Buffer.from(s, "latin1");
  const objects: string[] = [];
  const pageRefs = pages.map((_, i) => `${5 + i} 0 R`).join(" ");
  objects.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  objects.push(
    `2 0 obj << /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >> endobj`
  );
  objects.push(`3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  objects.push(`4 0 obj << >> endobj`);
  pages.forEach((_, i) => {
    const contentObj = 5 + pages.length + i;
    objects.push(
      `${5 + i} 0 obj << /Type /Page /Parent 2 0 R /Contents ${contentObj} 0 R >> endobj`
    );
  });
  pages.forEach((text, i) => {
    const contentObj = 5 + pages.length + i;
    const streamText = `BT /F1 12 Tf (Page ${i + 1} : ${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    if (compress) {
      const deflated = deflateSync(Buffer.from(streamText, "latin1"));
      objects.push(
        `${contentObj} 0 obj << /Length ${deflated.length} /Filter /FlateDecode >> stream\n${deflated.toString(
          "latin1"
        )}\nendstream endobj`
      );
    } else {
      objects.push(
        `${contentObj} 0 obj << /Length ${streamText.length} >> stream\n${streamText}\nendstream endobj`
      );
    }
  });

  const body = "%PDF-1.4\n";
  const offsets: number[] = [];
  const encoder = (s: string) => enc(s);
  const parts: Buffer[] = [encoder(body)];
  let position = body.length;
  for (const obj of objects) {