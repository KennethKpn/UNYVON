-- 0021_nova_message_org_fk.sql
-- Enforce conversation/organization consistency at the database constraint
-- level. This avoids relying on a policy subquery for referential integrity.

alter table public.nova_conversations
  add constraint nova_conversations_id_org_key
  unique (id, organization_id);

alter table public.nova_messages
  add constraint nova_messages_conversation_org_fk
  foreign key (conversation_id, organization_id)
  references public.nova_conversations (id, organization_id)
  on delete cascade;

drop policy if exists "nova_messages_insert_owner" on public.nova_messages;

create policy "nova_messages_insert_owner"
  on public.nova_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
    and exists (
      select 1
      from public.nova_conversations c
      where c.id = public.nova_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

