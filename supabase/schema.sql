create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  preferred_currency text not null default 'NGN' check (preferred_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  category_type text not null check (category_type in ('income', 'expense', 'both')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check ((user_id is not null) <> (organization_id is not null))
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  description text not null default '' check (char_length(description) <= 240),
  transaction_date date not null,
  fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  start_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  subject text not null check (char_length(subject) between 4 and 140),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 3000),
  created_at timestamptz not null default now()
);

create index transactions_personal_date_idx on public.transactions (user_id, transaction_date desc) where organization_id is null;
create index transactions_org_date_idx on public.transactions (organization_id, transaction_date desc) where organization_id is not null;
create index transactions_category_idx on public.transactions (category_id);
create unique index transactions_fingerprint_uidx on public.transactions (fingerprint);
create index budgets_personal_idx on public.budgets (user_id, start_date desc) where organization_id is null;
create index budgets_org_idx on public.budgets (organization_id, start_date desc) where organization_id is not null;
create index categories_owner_idx on public.categories (user_id, organization_id);
create index memberships_user_idx on public.organization_members (user_id, organization_id);
create index support_tickets_requester_updated_idx on public.support_tickets (requester_id, updated_at desc);
create index support_tickets_org_updated_idx on public.support_tickets (organization_id, updated_at desc);
create index support_messages_ticket_created_idx on public.support_messages (ticket_id, created_at);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members where organization_id = target_org and user_id = auth.uid()); $$;

create or replace function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members where organization_id = target_org and user_id = auth.uid() and role = any(allowed_roles)); $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()); $$;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.categories (user_id, name, category_type, is_default) values
    (new.id, 'Salary', 'income', true),
    (new.id, 'Freelance', 'income', true),
    (new.id, 'Housing', 'expense', true),
    (new.id, 'Food & Dining', 'expense', true),
    (new.id, 'Groceries', 'expense', true),
    (new.id, 'Clothing', 'expense', true),
    (new.id, 'Utilities', 'expense', true),
    (new.id, 'Transportation', 'expense', true),
    (new.id, 'Bills', 'expense', true),
    (new.id, 'Health & wellness', 'expense', true),
    (new.id, 'Entertainment', 'expense', true),
    (new.id, 'Subscriptions', 'expense', true),
    (new.id, 'Personal care', 'expense', true),
    (new.id, 'Education', 'expense', true),
    (new.id, 'Gifts & donations', 'expense', true),
    (new.id, 'Other expenses', 'expense', true),
    (new.id, 'Other income', 'income', true);
  if new.raw_user_meta_data ->> 'workspace_type' = 'organization'
     and char_length(btrim(coalesce(new.raw_user_meta_data ->> 'organization_name', ''))) between 2 and 120 then
    insert into public.organizations (name, created_by)
    values (btrim(new.raw_user_meta_data ->> 'organization_name'), new.id);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_auth_user();

insert into public.categories (user_id, name, category_type, is_default)
select profile.id, defaults.name, defaults.category_type, true
from public.profiles profile
cross join (values
  ('Salary', 'income'),
  ('Freelance', 'income'),
  ('Housing', 'expense'),
  ('Food & Dining', 'expense'),
  ('Groceries', 'expense'),
  ('Clothing', 'expense'),
  ('Utilities', 'expense'),
  ('Transportation', 'expense'),
  ('Bills', 'expense'),
  ('Health & wellness', 'expense'),
  ('Entertainment', 'expense'),
  ('Subscriptions', 'expense'),
  ('Personal care', 'expense'),
  ('Education', 'expense'),
  ('Gifts & donations', 'expense'),
  ('Other expenses', 'expense'),
  ('Other income', 'income')
) as defaults(name, category_type)
where not exists (
  select 1 from public.categories category
  where category.user_id = profile.id and category.name = defaults.name
);

create or replace function public.create_owner_for_new_organization()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  insert into public.categories (organization_id, name, category_type, is_default) values
    (new.id, 'Revenue', 'income', true),
    (new.id, 'Operations', 'expense', true),
    (new.id, 'Travel', 'expense', true),
    (new.id, 'Software', 'expense', true),
    (new.id, 'Meals & groceries', 'expense', true),
    (new.id, 'Utilities', 'expense', true),
    (new.id, 'Marketing', 'expense', true),
    (new.id, 'Payroll', 'expense', true),
    (new.id, 'Office supplies', 'expense', true),
    (new.id, 'Contractors', 'expense', true),
    (new.id, 'Taxes & fees', 'expense', true),
    (new.id, 'Other expenses', 'expense', true),
    (new.id, 'Other income', 'income', true);
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute procedure public.create_owner_for_new_organization();

create or replace function public.touch_support_ticket_on_message()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.support_tickets set updated_at = now() where id = new.ticket_id;
  return new;
end;
$$;

create trigger on_support_message_created
  after insert on public.support_messages
  for each row execute procedure public.touch_support_ticket_on_message();

create or replace function public.validate_financial_category()
returns trigger language plpgsql set search_path = public
as $$
declare
  category_user uuid;
  category_org uuid;
begin
  if new.category_id is null then return new; end if;
  select user_id, organization_id into category_user, category_org
  from public.categories where id = new.category_id;
  if new.organization_id is null then
    if category_user is distinct from new.user_id or category_org is not null then
      raise exception 'Category does not belong to this personal workspace';
    end if;
  elsif category_org is distinct from new.organization_id then
    raise exception 'Category does not belong to this organization';
  end if;
  return new;
end;
$$;

create trigger validate_transaction_category
  before insert or update of category_id, user_id, organization_id on public.transactions
  for each row execute procedure public.validate_financial_category();
create trigger validate_budget_category
  before insert or update of category_id, user_id, organization_id on public.budgets
  for each row execute procedure public.validate_financial_category();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.platform_admins enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

create policy "profiles own read and update" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles own insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles own update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "organization members can view workspace" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "authenticated users can create organization" on public.organizations for insert to authenticated with check (created_by = auth.uid());
create policy "admins can update organization" on public.organizations for update to authenticated using (public.has_org_role(id, array['owner', 'admin'])) with check (public.has_org_role(id, array['owner', 'admin']));
create policy "owners can delete organization" on public.organizations for delete to authenticated using (public.has_org_role(id, array['owner']));

create policy "members can view organization membership" on public.organization_members for select to authenticated using (user_id = auth.uid() or public.is_org_member(organization_id));
create policy "owners and admins can add members" on public.organization_members for insert to authenticated with check (public.has_org_role(organization_id, array['owner']) or (role <> 'owner' and public.has_org_role(organization_id, array['admin'])));
create policy "owners and admins can update roles" on public.organization_members for update to authenticated using (public.has_org_role(organization_id, array['owner']) or (role <> 'owner' and public.has_org_role(organization_id, array['admin']))) with check (public.has_org_role(organization_id, array['owner']) or (role <> 'owner' and public.has_org_role(organization_id, array['admin'])));
create policy "owners and admins can remove members" on public.organization_members for delete to authenticated using (public.has_org_role(organization_id, array['owner']) or (role <> 'owner' and public.has_org_role(organization_id, array['admin'])));

create policy "members can view categories" on public.categories for select to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.is_org_member(organization_id)));
create policy "users can create own or org categories" on public.categories for insert to authenticated with check ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and user_id is null and public.has_org_role(organization_id, array['owner', 'admin'])));
create policy "owners can update categories" on public.categories for update to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin']))) with check ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin'])));
create policy "owners can delete categories" on public.categories for delete to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin'])));

create policy "users and org members can view transactions" on public.transactions for select to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.is_org_member(organization_id)));
create policy "members can create transactions" on public.transactions for insert to authenticated with check ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and user_id = auth.uid() and public.is_org_member(organization_id)));
create policy "creators or admins can update transactions" on public.transactions for update to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and (user_id = auth.uid() or public.has_org_role(organization_id, array['owner', 'admin'])))) with check ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.is_org_member(organization_id)));
create policy "creators or admins can delete transactions" on public.transactions for delete to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and (user_id = auth.uid() or public.has_org_role(organization_id, array['owner', 'admin']))));

create policy "users and org members can view budgets" on public.budgets for select to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.is_org_member(organization_id)));
create policy "owners and admins manage org budgets" on public.budgets for all to authenticated using ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin']))) with check ((organization_id is null and user_id = auth.uid()) or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin'])));

create policy "staff can read own platform admin record" on public.platform_admins for select to authenticated using (user_id = auth.uid());
create policy "requesters and support admins can read tickets" on public.support_tickets for select to authenticated using (requester_id = auth.uid() or public.is_platform_admin() or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin'])));
create policy "users can open personal or member workspace tickets" on public.support_tickets for insert to authenticated with check (requester_id = auth.uid() and (organization_id is null or public.is_org_member(organization_id)));
create policy "support admins can update tickets" on public.support_tickets for update to authenticated using (public.is_platform_admin() or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin']))) with check (public.is_platform_admin() or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin'])));

create policy "ticket participants can read messages" on public.support_messages for select to authenticated using (
  exists (
    select 1 from public.support_tickets ticket
    where ticket.id = ticket_id and (
      ticket.requester_id = auth.uid()
      or public.is_platform_admin()
      or (ticket.organization_id is not null and public.has_org_role(ticket.organization_id, array['owner', 'admin']))
    )
  )
);
create policy "ticket participants can send messages" on public.support_messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from public.support_tickets ticket
    where ticket.id = ticket_id and ticket.status <> 'resolved' and (
      ticket.requester_id = auth.uid()
      or public.is_platform_admin()
      or (ticket.organization_id is not null and public.has_org_role(ticket.organization_id, array['owner', 'admin']))
    )
  )
);