insert into public.categories (user_id, name, category_type, is_default)
select profile.id, defaults.name, defaults.category_type, true
from public.profiles as profile
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
  ('Revenue', 'income'),
  ('Operations', 'expense'),
  ('Travel', 'expense'),
  ('Software', 'expense'),
  ('Meals & groceries', 'expense'),
  ('Utilities', 'expense'),
  ('Marketing', 'expense'),
  ('Payroll', 'expense'),
  ('Office supplies', 'expense'),
  ('Contractors', 'expense'),
  ('Taxes & fees', 'expense'),
  ('Other expenses', 'expense'),
  ('Other income', 'income')
) as defaults(name, category_type)
where not exists (
  select 1
  from public.categories as category
  where category.organization_id = organization.id
    and category.name = defaults.name
);
