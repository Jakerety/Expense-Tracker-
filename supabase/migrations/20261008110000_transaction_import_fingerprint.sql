create extension if not exists "pgcrypto";

alter table public.transactions
  add column if not exists fingerprint text;

with candidate_fingerprints as (
  select
    id,
    encode(
      digest(
        concat_ws(
          '|',
          coalesce(organization_id::text, user_id::text),
          transaction_date::text,
          transaction_type,
          amount::text,
          currency,
          lower(trim(regexp_replace(description, '\s+', ' ', 'g')))
        ),
        'sha256'
      ),
      'hex'
    ) as fingerprint,
    count(*) over (
      partition by
        coalesce(organization_id, user_id),
        transaction_date,
        transaction_type,
        amount,
        currency,
        lower(trim(regexp_replace(description, '\s+', ' ', 'g')))
    ) as matching_rows
  from public.transactions
  where fingerprint is null
)
update public.transactions transaction_row
set fingerprint = candidate.fingerprint
from candidate_fingerprints candidate
where transaction_row.id = candidate.id
  and candidate.matching_rows = 1
  and not exists (
    select 1
    from public.transactions existing
    where existing.fingerprint = candidate.fingerprint
  );

create unique index if not exists transactions_fingerprint_uidx
  on public.transactions (fingerprint);
