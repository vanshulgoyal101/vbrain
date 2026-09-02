-- vbrain capture inbox — additive + namespaced (safe to re-run).
-- Apply to your own Supabase project.
--
-- Captures are private: RLS is on and there are NO anon/authenticated policies,
-- so only the SERVICE ROLE (used by the auth-gated brain Worker) can
-- read or write. The public anon key cannot touch this table.

create table if not exists public.vbrain_captures (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  text        text not null check (char_length(text) between 1 and 8000),
  source      text not null default 'web',
  filed       boolean not null default false
);

create index if not exists vbrain_captures_unfiled_idx
  on public.vbrain_captures (created_at desc) where filed = false;

alter table public.vbrain_captures enable row level security;
-- (no policies on purpose — service-role-only access)
