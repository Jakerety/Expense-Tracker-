create or replace function public.list_organization_members(target_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_org_role(target_organization_id, array['owner', 'admin']) then
    raise exception 'Workspace admin access is required' using errcode = '42501';
  end if;

  return query
    select member.user_id, auth_user.email::text, coalesce(profile.full_name, ''), member.role, member.created_at
    from public.organization_members as member
    join auth.users as auth_user on auth_user.id = member.user_id
    left join public.profiles as profile on profile.id = member.user_id
    where member.organization_id = target_organization_id
    order by member.created_at;
end;
$$;

revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;

create or replace function public.add_organization_member_by_email(
  target_organization_id uuid,
  member_email text,
  member_role text
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_role text;
  target_user_id uuid;
begin
  select membership.role into requester_role
  from public.organization_members as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = auth.uid();

  if requester_role is null or requester_role not in ('owner', 'admin') then
    raise exception 'Workspace admin access is required' using errcode = '42501';
  end if;
  if member_role not in ('admin', 'member') then
    raise exception 'Invalid workspace role' using errcode = '22023';
  end if;
  if requester_role <> 'owner' and member_role <> 'member' then
    raise exception 'Only the workspace owner can add an admin' using errcode = '42501';
  end if;

  select auth_user.id into target_user_id
  from auth.users as auth_user
  where lower(auth_user.email) = lower(member_email);
  if target_user_id is null then
    raise exception 'No account exists for this email address' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (target_organization_id, target_user_id, member_role);

  return query
    select member.user_id,
      auth_user.email::text,
      coalesce(profile.full_name, ''),
      member.role,
      member.created_at
    from public.organization_members as member
    join auth.users as auth_user on auth_user.id = member.user_id
    left join public.profiles as profile on profile.id = member.user_id
    where member.organization_id = target_organization_id
      and member.user_id = target_user_id;
end;
$$;

revoke all on function public.add_organization_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.add_organization_member_by_email(uuid, text, text) to authenticated;
