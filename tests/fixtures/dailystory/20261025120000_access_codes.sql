-- COPY of seq23/dailystory supabase/migrations/20261025120000_access_codes.sql (landed in #72),
-- verbatim except the seed label (a real name, redacted: this repo is public). Read by
-- tests/simoneCommands.test.ts to pin ACCESS_CODE_SHAPE to the real table. Refresh:
-- git -C ~/GitHub/dailystory show origin/main:supabase/migrations/20261025120000_access_codes.sql

-- Access-code trials (Oct 2026). A parent types a code where they start the trial;
-- create-checkout looks it up here and sets the Stripe trial to its trial_days.
-- Add a code with one INSERT; no rebuild needed. Idempotent: safe to apply twice.
-- Rules: supabase/functions/_shared/accessCodeRules.ts. Pinned by
-- src/test/guards/access-code-trial.test.ts.

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  -- stored normalised: upper case, no whitespace ("homeschool 15" is typed, HOMESCHOOL15 is stored)
  code text not null unique check (code <> '' and code = upper(regexp_replace(code, '\s', '', 'g'))),
  trial_days integer not null check (trial_days between 1 and 730),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per checkout started with a code; status moves to 'completed' when
-- Stripe reports checkout.session.completed (stripe-webhook).
create table if not exists public.access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references public.access_codes(id),
  code text not null,
  trial_days integer not null,
  user_id uuid not null,
  stripe_session_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'checkout_started' check (status in ('checkout_started', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists access_code_redemptions_code_idx on public.access_code_redemptions (access_code_id);

-- Service role only: RLS on with no policies, and no grants to the API roles.
alter table public.access_codes enable row level security;
alter table public.access_code_redemptions enable row level security;
revoke all on public.access_codes from anon, authenticated;
revoke all on public.access_code_redemptions from anon, authenticated;

-- Signups per code: select * from public.access_code_signups;
create or replace view public.access_code_signups with (security_invoker = true) as
select c.code,
       c.label,
       c.trial_days,
       c.active,
       count(r.id) as checkouts_started,
       count(r.id) filter (where r.status = 'completed') as signups
from public.access_codes c
left join public.access_code_redemptions r on r.access_code_id = c.id
group by c.id, c.code, c.label, c.trial_days, c.active;
revoke all on public.access_code_signups from anon, authenticated;

insert into public.access_codes (code, trial_days, label)
values ('HOMESCHOOL15', 15, 'Homeschool group')
on conflict (code) do nothing;
