begin;

alter policy import_sessions_update_owner_manager
on public.import_sessions
to authenticated
using (
  is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
)
with check (
  created_by = (select auth.uid())
  and is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
);

alter policy import_documents_update_owner_manager
on public.import_documents
to authenticated
using (
  is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
)
with check (
  is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
);

alter policy import_items_update_owner_manager
on public.import_items
to authenticated
using (
  is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
)
with check (
  is_org_member(organization_id)
  and current_org_role(organization_id) in ('owner', 'manager')
);

commit;