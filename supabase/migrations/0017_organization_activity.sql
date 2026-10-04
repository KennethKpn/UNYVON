-- ============================================================================
-- UNYVON — ONBOARDING ACTIVITY PERSISTENCE
-- Rend persistant la description d'activité saisie à l'étape 2.
-- ============================================================================

alter table public.organizations
  add column if not exists activity_description text not null default '';

comment on column public.organizations.activity_description is
  'Description libre de l''activité de l''organisation, utilisée par l''onboarding et NOVA.';
