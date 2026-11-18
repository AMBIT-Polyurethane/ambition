-- 0088: a quality score on each price request (what it's worth to AMBIT), worked out by the app and the AI from every
-- price request in the last 90 days. Only price approvers see it. Scored once; "Score again" refreshes it.

create table if not exists public.price_request_scores (
  request_id     bigint primary key references public.price_requests(id) on delete cascade,
  score          int not null check (score between 0 and 100),
  grade          text not null,
  parts          jsonb not null default '{}',  -- the app's own sub-scores: price, volume, customer, details
  metrics        jsonb not null default '{}',  -- each line against the last 90 days, the customer, the rep
  ai             jsonb,                        -- the AI's headline, strengths, concerns, recommendation
  model          text,
  cost_cents     numeric(10,3) not null default 0,
  scored_by_name text,
  scored_at      timestamptz not null default now()
);
alter table public.price_request_scores enable row level security;
drop policy if exists price_request_scores_read on public.price_request_scores;
create policy price_request_scores_read on public.price_request_scores for select to authenticated using (public.has_perm('prf_approve'));
revoke insert, update, delete on public.price_request_scores from anon, authenticated;
grant select on public.price_request_scores to authenticated;

create or replace function public.price_request_score_save(p_request bigint, p_score int, p_grade text, p_parts jsonb, p_metrics jsonb,
  p_ai jsonb, p_model text, p_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('prf_approve') then raise exception 'Only price approvers can do that.'; end if;
  if not exists (select 1 from public.price_requests where id = p_request) then raise exception 'Price request not found.'; end if;
  insert into public.price_request_scores as s (request_id, score, grade, parts, metrics, ai, model, cost_cents, scored_by_name, scored_at)
  values (p_request, greatest(0, least(100, p_score)), left(coalesce(p_grade, '?'), 2), coalesce(p_parts, '{}'), coalesce(p_metrics, '{}'), p_ai,
          p_model, coalesce(p_cost, 0), public.my_name(), now())
  on conflict (request_id) do update set
    score = excluded.score, grade = excluded.grade, parts = excluded.parts, metrics = excluded.metrics, ai = excluded.ai,
    model = excluded.model, cost_cents = s.cost_cents + excluded.cost_cents, scored_by_name = excluded.scored_by_name, scored_at = now();
end $$;
revoke all on function public.price_request_score_save(bigint, int, text, jsonb, jsonb, jsonb, text, numeric) from public, anon;
grant execute on function public.price_request_score_save(bigint, int, text, jsonb, jsonb, jsonb, text, numeric) to authenticated;

select 'Ready (should be 2)' as "Check",
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'price_request_scores')
  + (select count(*) from pg_proc where proname = 'price_request_score_save' and pronamespace = 'public'::regnamespace) as "Count";
