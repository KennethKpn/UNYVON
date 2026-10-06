begin;

do $do$
declare
  v_definition text;
  v_before text := '  if v_document.state = ''extracted'' then';
  v_after text := '  if v_session.state not in (''processing'', ''needs_review'') then
    raise exception
      ''Matérialisation autorisée pendant le traitement/review uniquement (session: %)'',
      v_session.state;
  end if;

  if v_document.state = ''extracted'' then';
begin
  select pg_catalog.pg_get_functiondef(
    'public.materialize_import_document(uuid,jsonb,integer)'::regprocedure
  )
  into v_definition;

  if v_definition is null then
    raise exception 'RPC materialize_import_document absente';
  end if;

  if position(v_before in v_definition) = 0 then
    raise exception 'Version inattendue de materialize_import_document : ancrage idempotence introuvable';
  end if;

  if position(
    '  if v_session.state not in (''processing'', ''needs_review'') then'
    in v_definition
  ) > 0 then
    raise exception 'materialize_import_document contient déjà le garde de session';
  end if;

  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$do$;

commit;
