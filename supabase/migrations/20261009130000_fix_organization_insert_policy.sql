drop policy if exists "authenticated users can create organization" on public.organizations;

create policy "authenticated users can create organization"
  on public.organizations
  for insert
  to authenticated
  with check (created_by = auth.uid());
