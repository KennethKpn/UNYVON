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
-- (auth.uid() renommé via le claim `sub`). L'INTÉGRALITÉ du script est encadrée
-- par un unique BEGIN … ROLLBACK : aucune donnée de test n'est persistée.
--
-- RÉVERSIBILITÉ : le helper test_set_auth est créé DANS cette transaction,
-- annulée par le ROLLBACK final : il ne survit jamais à une exécution réussie
-- — et pas davantage à une exécution en échec (la transaction est alors
-- avortée). Un cleanup explicite + une assertion post-rollback ferment le cas
-- d'un run antérieur qui l'aurait laissé installé.
-- Raison de sécurité : public.test_set_auth est SECURITY DEFINER ; laissé
-- installé, il est appelable par PUBLIC (défaut Postgres sur le schéma
-- public) et permet d'usurper n'importe quel `sub` → contournement de RLS.
--
-- Le ROLLBACK couvre les mutations de données du § 3 (`update public.
-- organizations set name = 'PIRATAGE'`) : si l'isolation RLS régressait, ce
-- nom ne doit en aucun cas être écrit durablement dans la base.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Prérequis : des utilisateurs existent dans auth.users (créés via signup).
--    Les requêtes ci-dessous vérifient la logique RLS de façon déterministe en
--    s'appuyant sur organization_users, indépendamment des UUID réels.
-- ---------------------------------------------------------------------------

-- Helper : set le JWT "sub" de l'utilisateur courant (equiv. auth.uid()).
-- Créé dans la transaction ci-dessus → jamais persisté.
create or replace function public.test_set_auth(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- true = SET LOCAL : le contexte d'impersonation n'existe que dans la
  -- transaction et est annule par le ROLLBACK (jamais residues en session).
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid::text,
    'role', 'authenticated'
  )::text, true);
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
  v_user_a uuid;
  v_user_b uuid;
  v_org_a  uuid;
  v_updated int;
begin
  -- 3.1 Organisation A : premier owner par ancienneté
  select user_id, organization_id into v_user_a, v_org_a
    from public.organization_users
   where role = 'owner'
   order by created_at
   limit 1;

  -- 3.2 Utilisateur B : owner d'une organisation DISTINTE de A. Ce filtre est
  --     indispensable : sans lui, deux owners d'une même organisation étaient
  --     retenus comme couple A/B, la RLS autorisait alors légitimement
  --     l'écriture, et le test levait un faux « ECHEC D'ISOLATION » alors que
  --     l'isolation était intacte.
  select user_id into v_user_b
    from public.organization_users
   where role = 'owner'
     and organization_id <> v_org_a
   order by created_at
   limit 1;

  if v_user_b is null then
    raise notice 'Il faut au moins 2 organisations distinctes pour tester l''isolation (créez 2 comptes/onboarding).';
    return;
  end if;

  perform public.test_set_auth(v_user_b);
  set local role authenticated;

  -- 3.3 Cible = organisation A, désignée explicitement (et non ré-approvisionnée
  --     par une sous-requête implicite, susceptible de viser une autre org).
  update public.organizations
     set name = 'PIRATAGE'
   where id = v_org_a;

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
-- 4. Annulation : aucune donnée de test ne doit subsister
--
-- Le `update public.organizations set name = 'PIRATAGE'` du § 3 est ici annulé.
-- Ce ROLLBACK est l'unique point de sortie de la transaction ouverte en tête de
-- script : c'est lui qui garantit qu'un test exécuté — quelle que soit sa
-- sortie — ne laisse aucune ligne modifiée en base.
-- ---------------------------------------------------------------------------
rollback;

-- ---------------------------------------------------------------------------
-- 5. Réversibilité : aucun objet auxiliaire ne doit subsister
--
-- Le ROLLBACK ci-dessus a déjà supprimé test_set_auth. Ce bloc couvre le cas
-- d'un run antérieur (avant réversibilité) qui l'aurait laissé installé :
-- `drop ... if exists` est donc volontairement inconditionnel, et l'assertion
-- qui suit prouve l'absence effective plutôt que de la supposer.
-- ---------------------------------------------------------------------------
drop function if exists public.test_set_auth(uuid);

do $$
begin
  if to_regprocedure('public.test_set_auth(uuid)') is not null then
    raise exception
      'ECHEC : le helper public.test_set_auth(uuid) a survécu à la vérification';
  end if;
  raise notice 'OK : aucun objet auxiliaire test_set_auth ne subsiste';
end $$;
