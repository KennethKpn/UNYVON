-- ============================================================================
-- UNYVON — SMART DATA IMPORT PHASE 5D
-- Étend les fonctions existantes pour conserver stock_quantity dans
-- import_items.fields. Aucun stock métier n'est écrit par import_commit.
--
-- La définition de fonction est relue depuis PostgreSQL afin de ne pas recopier
-- 0013/0015 dans cette migration. Le code source 0015 est également corrigé
-- séparément dans le dépôt (END IF manquant).
-- ============================================================================

begin;

do $do$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_import_document(uuid, jsonb, integer)'::regprocedure
  )
  into v_definition;

  if v_definition not like '%stock_quantity%' then
    v_definition := replace(
      v_definition,
      '''min_stock_threshold'', ''category''',
      '''min_stock_threshold'', ''stock_quantity'', ''category'''
    );
    execute v_definition;
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.import_commit(uuid)'::regprocedure
  )
  into v_definition;

  if v_definition not like '%stock_quantity%' then
    v_definition := replace(
      v_definition,
      '''min_stock_threshold'', ''category''',
      '''min_stock_threshold'', ''stock_quantity'', ''category'''
    );
    execute v_definition;
  end if;
end;
$do$;

commit;
