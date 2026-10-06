-- ============================================================================
-- UNYVON — SMART DATA IMPORT — 0028 materialization stock contract
-- ============================================================================
-- 0027 recreated materialize_import_document(uuid,jsonb,integer,uuid) from
-- the pre-0016 body. That reintroduced the product-field allowlist without
-- stock_quantity, while the E2E extraction contract now legitimately emits it.
--
-- This corrective migration targets ONLY the active 4-argument RPC.
-- The 3-argument RPC is intentionally a lease-required guard and must remain
-- unchanged.
-- ============================================================================

begin;

do $do$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_import_document(uuid, jsonb, integer, uuid)'::regprocedure
  )
  into v_definition;

  if v_definition is null then
    raise exception
      'RPC materialize_import_document(uuid,jsonb,integer,uuid) absente';
  end if;

  -- Idempotence : une base déjà corrigée ne doit subir aucune réécriture.
  if position('stock_quantity' in v_definition) > 0 then
    return;
  end if;

  -- Le remplacement tolère les espaces/newlines générés par PostgreSQL.
  v_updated := pg_catalog.regexp_replace(
    v_definition,
    '''min_stock_threshold''[[:space:]]*,[[:space:]]*''category''',
    '''min_stock_threshold'', ''stock_quantity'', ''category''',
    1,
    1
  );

  if v_updated = v_definition
     or position(
       '''min_stock_threshold'', ''stock_quantity'', ''category'''
       in v_updated
     ) = 0
  then
    raise exception
      'Impossible d''étendre le contrat product de materialize_import_document(uuid,jsonb,integer,uuid)';
  end if;

  execute v_updated;
end;
$do$;

commit;
