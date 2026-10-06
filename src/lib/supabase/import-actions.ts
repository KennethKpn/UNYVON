      { p_document_id: document.id }
    );
    claimed = result.data;
    claimError = result.error;
  } else {
    throw new Error(
      `Extraction déjà en cours ou état non rejouable (${document.state})`
    );
  }

  if (claimError || !claimed) {
    throw new Error(
      `Document déjà pris en charge ou impossible à réserver : ${claimError?.message ?? "claim refusé"}`
    );
  }

  document = claimed as DatabaseImportDocument;
  let leaseId = document.processing_lease_id;
  if (!leaseId) {
    throw new Error(
      "Réservation d'extraction invalide : aucun lease serveur n'a été fourni"
    );
  }

  let artifact: ImportParsedArtifact;
  let bytes: Uint8Array | null = null;

  try {
    const prepared = await persistOrLoadParsedArtifact(
      supabase,
      document,
      claimFrom as "uploaded" | "parsed",
      leaseId,
      bytes
    );
    document = prepared.document;
    artifact = prepared.artifact;
    bytes = prepared.bytes;

    // Une passe uploaded→parsing ne conserve jamais le lease de lecture pour
    // la phase IA : celle-ci obtient un nouveau lease sous le plafond serveur.
    if (claimFrom === "uploaded") {
      const result = await supabase.rpc(
        "claim_import_extraction_slot",
        { p_document_id: document.id }
      );
      if (result.error || !result.data) {
        throw new Error(
          `Réservation de l'extraction impossible après lecture locale : ${result.error?.message ?? "claim refusé"}`
        );
      }
      document = result.data as DatabaseImportDocument;
      leaseId = document.processing_lease_id;
      if (!leaseId) {
        throw new Error(
          "Réservation d'extraction invalide après lecture locale : aucun lease serveur"
        );
      }
    }
  } catch (error) {
    const originalError =
      error instanceof Error ? error : new Error(String(error));

    if (document.state === "parsing") {
      // Une erreur locale peut déjà avoir été durablement enregistrée par
      // persistOrLoadParsedArtifact. Le fallback ne touche la ligne que si
      // elle est encore exactement sous notre lease de lecture.
      const { error: failError } = await supabase
        .from("import_documents")
        .update({
          state: "failed",
          processing_lease_id: null,
          processing_lease_expires_at: null,
          error_message: originalError.message,
        })
        .eq("id", document.id)
        .eq("state", "parsing")
        .eq("processing_lease_id", leaseId);

      if (failError) {
        throw new Error(
          "Extraction échouée (" +
            originalError.message +
            ") et état impossible à persister : " +
            failError.message
        );
      }
      // 0 ligne modifiée est volontairement non fatal : cela signifie que le
      // lease a déjà été libéré, remplacé, ou que l'erreur était déjà persistée.
    }

    throw originalError;
  }

  // Après parsed, seule la structuration IA est reprise. Pour les documents
  // texte, aucune relecture binaire ni décompression n'est nécessaire.
  const requiresSourceBytes =
    artifact.source === "image-llm" || artifact.source === "pdf-llm";
  if (requiresSourceBytes && !bytes) {
    bytes = await downloadImportDocumentBytes(supabase, document);
  }

  try {
    const extracted = await structureParsedDocument(
      {
        documentId: document.id,
        sourceKind: document.source_kind,
        filename: document.original_name,
        bytes: bytes ?? new Uint8Array(),
      },
      artifact,
      createDefaultProvider()
    );
