-- 0019_nova_conversations.sql
-- NOVA conversational layer: durable user-owned conversation history.
-- No model credentials or provider responses are persisted here.

create table public.nova_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Conversation avec NOVA',
  provider text not null default 'gemini',
  model text not null default 'gemini-3.8-flash',
  gemini_interaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nova_conversations_org_idx
  on public.nova_conversations(organization_id, updated_at desc);
create index nova_conversations_user_idx
  on public.nova_conversations(user_id, updated_at desc);

alter table public.nova_conversations enable row level security;

create policy "nova_conversations_select_owner"
  on public.nova_conversations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

create policy "nova_conversations_insert_owner"
  on public.nova_conversations
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

create policy "nova_conversations_update_owner"
  on public.nova_conversations
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

create policy "nova_conversations_delete_owner"
  on public.nova_conversations
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

create table public.nova_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nova_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(trim(content)) between 1 and 20000),
  created_at timestamptz not null default now()
);

create index nova_messages_conversation_idx
  on public.nova_messages(conversation_id, created_at asc);
create index nova_messages_owner_idx
  on public.nova_messages(user_id, organization_id, created_at desc);

alter table public.nova_messages enable row level security;

create policy "nova_messages_select_owner"
  on public.nova_messages
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

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
      where c.id = conversation_id
        and c.organization_id = organization_id
        and c.user_id = auth.uid()
    )
  );

create policy "nova_messages_delete_owner"
  on public.nova_messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

comment on table public.nova_conversations is
  'Persistent user-owned conversations with NOVA. Provider interaction IDs are opaque references.';
comment on table public.nova_messages is
  'User-visible NOVA conversation messages, isolated by user and organization.';
