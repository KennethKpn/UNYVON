-- ============================================================================
-- UNYVON — Vérification de l'isolation multi-tenant (RLS)
--
-- À exécuter dans le SQL Editor Supabase APRÈS avoir appliqué
-- supabase/migrations/0001_foundation.sql.
--
-- But : prouver qu'un utilisateur de l'organisation A ne peut PAS lire ou
-- modifier les données de l'organisation B — la sécurité est assurée par
-- PostgreSQL/RLS, pas par le frontend.
--
-- Technique : impersonation du rôle `authenticated` avec un JWT factice
-- (auth.uid() renommé via le claim `sub`). Toute la séquence de test est
-- enveloppée dans une transaction unique ; le ROLLBACK final annule toutes
-- les mutations, y compris la création temporaire du helper.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REVERSIBILITY : ce script ne doit laisser aucune mutation métier ni helper
-- de test persistant. Une transaction unique est ouverte avant la création
-- du helper et le ROLLBACK final annule l'ensemble des opérations.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 0. Prérequis : des utilisateurs existent dans auth.users (créés via signup).
--    Les requêtes ci-dessous vérifient la logique RLS de façon déterministe en
--    s'appuyant sur organization_users, indépendamment des UUID réels.
-- ---------------------------------------------------------------------------

-- Helper : set le JWT "sub" de l'utilisateur courant (equiv. auth.uid())
-- Créé dans la transaction ci-dessus : le ROLLBACK final doit le faire disparaître
-- sans DROP destructif qui pourrait supprimer une fonction préexistante.
create or replace function public.test_set_auth(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid::text,
    'role', 'authenticated'
  )::text, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Cas nominal : le owner voit SA propre organisation
-- ---------------------------------------------------------------------------
-- Remplacer <un_user_id> par un UUID d'un utilisateur ayant une organisation.
do $$
declare
  v_user uuid;
  v_org  uuid;
  v_count bigint;
begin
  select user_id, organization_id into v_user, v_org
    from public.organization_users
   where role = 'owner'
   limit 1;

  if v_user is null then
    raise notice 'Aucun owner trouvé : créez d''abord un compte via le signup puis l''onboarding.';
    return;
  end if;

  perform public.test_set_auth(v_user);

  -- Impersonation du rôle pour activer RLS
  set local role authenticated;

  select count(*) into v_count
    from public.organizations
   where id = v_org;

  reset role;
  perform public.test_set_auth(null);

  if v_count = 1 then
    raise notice 'OK : le owner voit son organisation (% lignes)', v_count;
  else
    raise exception 'ECHEC : le owner ne voit pas sa propre organisation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Isolation : l'utilisateur B ne voit PAS les données de l'organisation A
-- ---------------------------------------------------------------------------
do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_org_a  uuid;
  v_org_b  uuid;
  v_count  bigint;
begin
  -- Deux organisations distinctes avec deux owners distincts
  select ou.user_id, ou.organization_id into v_user_a, v_org_a
    from public.organization_users ou
   where ou.role = 'owner'
   order by ou.created_at
   limit 1 offset 0;

  select ou.user_id, ou.organization_id into v_user_b, v_org_b
    from public.organization_users ou
   where ou.role = 'owner'
     and ou.organization_id <> v_org_a
   order by ou.created_at
   limit 1;

  if v_user_b is null then
    raise notice 'Il faut au moins 2 organisations distinctes pour tester l''isolation (créez 2 comptes/onboarding).';
    return;
  end if;

  -- L'utilisateur B tente de lire l'organisation A
  perform public.test_set_auth(v_user_b);
  set local role authenticated;

  select count(*) into v_count
    from public.organizations
   where id = v_org_a;

  reset role;
  perform public.test_set_auth(null);

  if v_count = 0 then
    raise notice 'OK : l''utilisateur B ne voit PAS l''organisation A (isolation RLS confirmée)';
  else
    raise exception 'ECHEC D''ISOLATION : l''utilisateur B a lu les données de l''organisation A';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Isolation : l'utilisateur B ne peut PAS modifier l'organisation A
-- ---------------------------------------------------------------------------
do $$
declare
  v_user_b uuid;
  v_org_a  uuid;
  v_updated int;
begin
  select user_id, organization_id into v_user_b, v_org_a
    from public.organization_users
   where role = 'owner'
   order by created_at
   limit 1 offset 1;

  if v_user_b is null then
    raise notice 'Besoin d''au moins 2 owners pour ce test.';
    return;
  end if;

  perform public.test_set_auth(v_user_b);
  set local role authenticated;

  update public.organizations
     set name = 'PIRATAGE'
   where id = (select organization_id
                 from public.organization_users
                where role='owner' order by created_at limit 1);

  get diagnostics v_updated = row_count;

  reset role;
  perform public.test_set_auth(null);

  if v_updated = 0 then
    raise notice 'OK : l''utilisateur B ne peut pas modifier l''organisation A (0 ligne)';
  else
    raise exception 'ECHEC D''ISOLATION : modification cross-org possible (% lignes)', v_updated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Réversibilité : annuler TOUTES les mutations de cette vérification.
-- Le helper test_set_auth(uuid) a été créé dans cette même transaction et
-- disparaît donc avec le ROLLBACK ; aucun DROP post-rollback n'est exécuté.
-- ---------------------------------------------------------------------------
rollback;

-- Contrôle post-rollback : le helper temporaire ne doit pas avoir survécu.
do $$
begin
  if to_regprocedure('public.test_set_auth(uuid)') is null then
    raise notice 'OK : le helper public.test_set_auth(uuid) n''a pas survécu au ROLLBACK';
  else
    raise exception 'ECHEC DE REVERSIBILITE : public.test_set_auth(uuid) existe encore après ROLLBACK';
  end if;
end $$;
