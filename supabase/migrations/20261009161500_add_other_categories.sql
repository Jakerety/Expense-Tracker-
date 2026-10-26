insert into public.categories (user_id, name, category_type, is_default)
select profile.id, defaults.name, defaults.category_type, true
from public.profiles as profile
cross join (values
  ('Other expenses', 'expense'),
  ('Other income', 'income')
) as defaults(name, category_type)
where not exists (
  select 1
  from public.categories as category
  where category.user_id = profile.id
    and category.organization_id is null
    and category.name = defaults.name
);

insert into public.categories (organization_id, name, category_type, is_default)
select organization.id, defaults.name, defaults.category_type, true
from public.organizations as organization
cross join (values
  ('Other expenses', 'expense'),
  ('Other income', 'income')
) as defaults(name, category_type)
where not exists (
  select 1
  from public.categories as category
  where category.organization_id = organization.id
    and category.name = defaults.name
);
