-- 0020_nova_message_policy_hardening.sql
-- Harden NOVA message ownership checks with an explicit three-identity match:
-- conversation, organization and authenticated user.
--
-- The helper is SECURITY INVOKER (no privilege escalation) and only callable
-- by signed-in users through the exposed public schema.

create or replace function public.nova_conversation_matches(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.nova_conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.user_id = p_user_id
  );
$$;

revoke all on function public.nova_conversation_matches(uuid, uuid, uuid) from public;
grant execute on function public.nova_conversation_matches(uuid, uuid, uuid) to authenticated;

drop policy if exists "nova_messages_insert_owner" on public.nova_messages;

create policy "nova_messages_insert_owner"
  on public.nova_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
    and public.nova_conversation_matches(
      conversation_id,
      organization_id,
      auth.uid()
    )
  );
