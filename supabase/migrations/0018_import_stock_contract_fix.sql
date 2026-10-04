-- UNYVON — harden Smart Import stock field contract
-- Corrective migration for 0016: tolerate PostgreSQL formatting differences
-- when extending import_commit's product-field allowlist.
begin;

do $do$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.import_commit(uuid)'::regprocedure
  )
  into v_definition;

  if position('stock_quantity' in v_definition) > 0 then
    return;
  end if;

  v_updated := pg_catalog.regexp_replace(
    v_definition,
    '''min_stock_threshold''[[:space:]
,]+''category''',
    '''min_stock_threshold'', ''stock_quantity'', ''category''',
    1,
    1
  );

  if position('stock_quantity' in v_updated) = 0 then
    raise exception 'Impossible d''étendre le contrat product de import_commit';
  end if;

  execute v_updated;
end;
$do$;

commit;
