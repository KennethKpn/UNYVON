-- ============================================================================
-- UNYVON — PHASE 2F : Ventes
-- Tables : sales, sale_items
-- RPC : confirm_sale (atomique : vérifie stock + crée mouvements)
-- RLS : permissions owner/manager/seller
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Enum : statuts de vente
-- ---------------------------------------------------------------------------
create type public.sale_status as enum (
  'draft',
  'confirmed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- 2. Table : sales
-- ---------------------------------------------------------------------------
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  reference       text,
  status          public.sale_status not null default 'draft',
  sale_date       date not null default current_date,
  subtotal        numeric(14,2) not null default 0,
  total_amount    numeric(14,2) not null default 0,
  notes           text,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index sales_org_idx on public.sales(organization_id);
create index sales_customer_idx on public.sales(customer_id);
create index sales_status_idx on public.sales(status);
create index sales_date_idx on public.sales(sale_date);

-- ---------------------------------------------------------------------------
-- 3. Table : sale_items
--    total = quantity × unit_price (généré)
--    unit_cost_snapshot = coût au moment de la vente (historique)
-- ---------------------------------------------------------------------------
create table public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  quantity          integer not null check (quantity > 0),
  unit_price        numeric(12,2) not null check (unit_price >= 0),
  unit_cost_snapshot numeric(12,2) not null check (unit_cost_snapshot >= 0),
  total             numeric(14,2) not null generated always as (quantity::numeric * unit_price) stored,
  created_at        timestamptz not null default now()
);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_product_idx on public.sale_items(product_id);

-- ---------------------------------------------------------------------------
-- 4. Trigger : updated_at sur sales
-- ---------------------------------------------------------------------------
create trigger set_sales_updated_at
  before update on public.sales
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Trigger : recalculer subtotal/total_amount sur sales depuis sale_items
-- ---------------------------------------------------------------------------
create or replace function public.recalc_sale_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
begin
  v_sale_id := coalesce(NEW.sale_id, OLD.sale_id);

  update public.sales
  set
    subtotal = coalesce((
      select sum(si.total)
      from public.sale_items si
      where si.sale_id = v_sale_id
    ), 0),
    total_amount = coalesce((
      select sum(si.total)
      from public.sale_items si
      where si.sale_id = v_sale_id
    ), 0)
  where id = v_sale_id;

  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_recalc_sale_totals
  after insert or update or delete on public.sale_items
  for each row
  execute function public.recalc_sale_totals();

-- ---------------------------------------------------------------------------
-- 6. Trigger : valider que le customer appartient à l'organisation
-- ---------------------------------------------------------------------------
create or replace function public.validate_sale_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.customer_id is not null then
    if not exists (
      select 1 from public.customers
      where id = NEW.customer_id and organization_id = NEW.organization_id
    ) then
      raise exception 'Le client % n''appartient pas à l''organisation %.', NEW.customer_id, NEW.organization_id;
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_validate_sale_customer
  before insert or update on public.sales
  for each row
  execute function public.validate_sale_customer();

-- ---------------------------------------------------------------------------
-- 7. Trigger : valider que le produit appartient à l'organisation de la vente
-- ---------------------------------------------------------------------------
create or replace function public.validate_sale_item_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from public.sales where id = NEW.sale_id;

  if not exists (
    select 1 from public.products
    where id = NEW.product_id and organization_id = v_org_id
  ) then
    raise exception 'Le produit % n''appartient pas à l''organisation %.', NEW.product_id, v_org_id;
  end if;
  return NEW;
end;
$$;

create trigger trg_validate_sale_item_product
  before insert or update on public.sale_items
  for each row
  execute function public.validate_sale_item_product();

-- ---------------------------------------------------------------------------
-- 8. RPC : confirmer une vente (ATOMIQUE)
--    - Vérifie statut = draft
--    - Vérifie idempotence (pas de mouvements existants)
--    - Vérifie stock pour chaque produit
--    - Crée les mouvements inventory_movements (type: sale)
--    - Met à jour le statut → confirmed
-- ---------------------------------------------------------------------------
create or replace function public.confirm_sale(p_sale_id uuid)
returns public.sale_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   public.sale_status;
  v_org_id   uuid;
  v_already  integer;
  v_item     record;
  v_stock    integer;
  v_total_req integer;
begin
  -- Lock + read
  select status, organization_id into v_status, v_org_id
  from public.sales
  where id = p_sale_id
  for update;

  if v_status is null then
    raise exception 'Vente non trouvée: %', p_sale_id;
  end if;

  if v_status != 'draft' then
    raise exception 'Seule une vente en brouillon peut être confirmée. Statut actuel: %', v_status;
  end if;

  -- Vérifier l'idempotence
  select count(*) into v_already
  from public.inventory_movements
  where reference_type = 'sale' and reference_id = p_sale_id;

  if v_already > 0 then
    raise exception 'Les mouvements de stock pour cette vente existent déjà (% lignes).', v_already;
  end if;

  -- Vérifier stock pour chaque produit (considérer les doublons)
  for v_item in
    select product_id, sum(quantity) as total_qty
    from public.sale_items
    where sale_id = p_sale_id
    group by product_id
  loop
    v_stock := public.get_product_stock(v_org_id, v_item.product_id);
    if v_stock < v_item.total_qty then
      raise exception 'Stock insuffisant pour le produit %: disponible %, demandé %.',
        v_item.product_id, v_stock, v_item.total_qty;
    end if;
  end loop;

  -- Créer les mouvements de stock (un par ligne de vente)
  insert into public.inventory_movements
    (organization_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
  select
    v_org_id,
    si.product_id,
    'sale'::public.movement_type,
    si.quantity,
    si.unit_cost_snapshot,
    'sale',
    p_sale_id,
    auth.uid()
  from public.sale_items si
  where si.sale_id = p_sale_id;

  -- Mettre à jour le statut
  update public.sales
  set status = 'confirmed'
  where id = p_sale_id;

  return 'confirmed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS : activation + politiques
-- ---------------------------------------------------------------------------
alter table public.sales       enable row level security;
alter table public.sale_items  enable row level security;

-- ---- sales ----
-- Lecture : membre de l'org
create policy "sales_select_member"
  on public.sales for select
  to authenticated
  using (public.is_org_member(organization_id));

-- Création : owner, manager, ou seller
create policy "sales_insert_owner_manager_seller"
  on public.sales for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager', 'seller')
  );

-- Modification : owner ou manager (sur brouillons uniquement via RPC)
create policy "sales_update_owner_manager"
  on public.sales for update
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager', 'seller')
  );

-- Suppression : owner uniquement (sur brouillons)
create policy "sales_delete_owner"
  on public.sales for delete
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) = 'owner'
  );

-- ---- sale_items ----
-- Lecture : via la vente parente
create policy "sale_items_select_member"
  on public.sale_items for select
  to authenticated
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and public.is_org_member(s.organization_id)
    )
  );

-- Création : owner, manager, ou seller (via la vente parente)
create policy "sale_items_insert_owner_manager_seller"
  on public.sale_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and public.is_org_member(s.organization_id)
        and public.current_org_role(s.organization_id) in ('owner', 'manager', 'seller')
    )
  );

-- Modification : owner ou manager (via la vente parente)
create policy "sale_items_update_owner_manager"
  on public.sale_items for update
  to authenticated
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and public.is_org_member(s.organization_id)
        and public.current_org_role(s.organization_id) in ('owner', 'manager', 'seller')
    )
  );

-- Suppression : owner ou manager (via la vente parente)
create policy "sale_items_delete_owner_manager"
  on public.sale_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and public.is_org_member(s.organization_id)
        and public.current_org_role(s.organization_id) in ('owner', 'manager', 'seller')
    )
  );

commit;
