-- 0022_nova_retire_unused_helper_access.sql
-- The temporary policy helper from 0020 is no longer used after the
-- conversation/organization composite foreign key was introduced in 0021.
-- Remove direct RPC execution rights without dropping the function.

revoke all on function public.nova_conversation_matches(uuid, uuid, uuid)
  from public, anon, authenticated;
