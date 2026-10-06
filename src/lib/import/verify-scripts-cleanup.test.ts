  it("n'autorise la reprise que sur expiration côté PostgreSQL", () => {
    expect(lease).toContain("recover_stale_import_document");
    expect(lease).toContain("processing_lease_expires_at is null");
    expect(lease).toContain("processing_lease_expires_at > pg_catalog.clock_timestamp()");
    expect(lease).toContain("Lease encore actif");
    expect(lease).toContain("processing_lease_id = null");
    expect(lease).toContain("processing_lease_expires_at = null");
  });

  it("fence la matérialisation : lease obligatoire, expiré ou remplacé refusé", () => {
    expect(lease).toContain(
      "processing_lease_expires_at <= pg_catalog.clock_timestamp()"
    );
    expect(lease).toContain(
      "Lease d''extraction invalide, expiré ou remplacé : matérialisation refusée"
    );
    expect(lease).toContain(
      "Lease d''extraction perdu pendant la matérialisation : résultat refusé"
    );
    expect(lease).toContain(
      "revoke execute on function public.materialize_import_document(uuid, jsonb, integer, uuid) from public, anon;"
    );
    expect(lease).toContain(
      "grant execute on function public.materialize_import_document(uuid, jsonb, integer, uuid) to authenticated;"
    );
  });

  it("fait échouer fermé l'ancien RPC trois-arguments au lieu de permettre un contournement", () => {
    expect(lease).toContain(
      "Lease d''extraction requis : utilisez materialize_import_document(uuid, jsonb, integer, uuid)"
    );
    expect(lease).toContain(
      "revoke execute on function public.materialize_import_document(uuid, jsonb, integer) from public, anon;"
    );
  });

  it("réclame les leases expirés avant de recalculer la capacité IA", () => {
    const reclaim = lease.indexOf("update public.import_documents");
    const count = lease.indexOf("select count(*)");
    expect(reclaim).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(-1);
    expect(reclaim).toBeLessThan(count);
    expect(lease).toContain("CAPACITE_EXTRACTION_ATTEINTE");
  });

  it("reste SECURITY INVOKER et interdit les appels anonymes", () => {
    expect(lease).not.toMatch(/security\s+definer/i);
    expect(lease).toMatch(/security\s+invoker/i);
    expect(lease).toContain(
      "revoke execute on function public.claim_import_parsing_lease(uuid) from public, anon;"
    );
    expect(lease).toContain(
      "revoke execute on function public.recover_stale_import_document(uuid) from public, anon;"
    );
  });
});