create or replace function public.create_organization(
  organization_name text,
  organization_currency text default 'NGN'
)
returns setof public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
    insert into public.organizations (name, currency, created_by)
    values (organization_name, organization_currency, requesting_user)
    returning *;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
