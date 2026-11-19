-- 0094: price requests with a quality score of 85 or better are approved automatically (Auto-approve rules page).
--  * When a rep sends a price request, the app scores it right away (0088's score) and saves it here.
--  * If the score rule is on and the score is high enough, every line still waiting is approved at the price asked,
--    in the name set on the rules page (Jeremiah Bryant), and the customer's prices update like any approval.
--  * Only the app's server can call this (not a signed-in person), so nobody can send a made-up score.
-- Safe to run again.

create or replace function public.price_request_score_auto(p_request bigint, p_score int, p_grade text, p_parts jsonb, p_metrics jsonb,
  p_ai jsonb, p_model text, p_cost numeric)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_rule jsonb := coalesce((select value -> 'score_auto' from public.app_settings where key = 'price_rules'), '{}'::jsonb);
  v_min int := coalesce(nullif(v_rule ->> 'min', '')::int, 85);
  v_by text := coalesce(nullif(trim(v_rule ->> 'approver'), ''), 'AMBIT');
  v_score int := greatest(0, least(100, p_score));
  r public.price_requests;
  v_p int; v_a int; v_d int; v_status text;
begin
  select * into r from public.price_requests where id = p_request;
  if r.id is null then raise exception 'Price request not found.'; end if;
  insert into public.price_request_scores as s (request_id, score, grade, parts, metrics, ai, model, cost_cents, scored_by_name, scored_at)
  values (p_request, v_score, left(coalesce(p_grade, '?'), 2), coalesce(p_parts, '{}'), coalesce(p_metrics, '{}'), p_ai, p_model, coalesce(p_cost, 0), 'Scored when sent', now())
  on conflict (request_id) do update set
    score = excluded.score, grade = excluded.grade, parts = excluded.parts, metrics = excluded.metrics, ai = excluded.ai,
    model = excluded.model, cost_cents = s.cost_cents + excluded.cost_cents, scored_by_name = excluded.scored_by_name, scored_at = now();

  if r.status <> 'pending' or coalesce((v_rule ->> 'enabled')::boolean, false) is not true or v_score < v_min then
    return r.status;
  end if;

  update public.price_request_lines
     set status = 'approved', approved_price = requested_price, auto = true,
         rule = 'Quality score ' || v_score || ' (' || v_min || '+ rule)'
   where request_id = p_request and status = 'pending';
  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved'), count(*) filter (where status = 'denied')
    into v_p, v_a, v_d from public.price_request_lines where request_id = p_request;
  v_status := case when v_p > 0 then 'pending' when v_d = 0 then 'approved' when v_a = 0 then 'denied' else 'partly' end;
  update public.price_requests
     set status = v_status, decided_by_name = v_by, decided_at = now(),
         decision_note = 'Approved automatically: quality score ' || v_score || ' (the rule approves ' || v_min || ' or better).'
   where id = p_request;
  if v_status in ('approved', 'partly') then perform public.customer_prices_from_request(p_request); end if;
  return v_status;
end $fn$;
revoke all on function public.price_request_score_auto(bigint, int, text, jsonb, jsonb, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.price_request_score_auto(bigint, int, text, jsonb, jsonb, jsonb, text, numeric) to service_role;

-- Turn the rule on: 85 or better, approved as Jeremiah Bryant.
insert into public.app_settings (key, value, updated_at, updated_by_name)
values ('price_rules', '{"enabled": false, "max_pct": 5, "cat_pct": {}, "never": [], "max_lines": 15}'::jsonb, now(), 'Jeremiah Bryant')
on conflict (key) do nothing;
update public.app_settings
   set value = value || jsonb_build_object('score_auto', jsonb_build_object('enabled', true, 'min', 85, 'approver', 'Jeremiah Bryant')),
       updated_at = now(), updated_by_name = 'Jeremiah Bryant'
 where key = 'price_rules';

-- Check: should say 1
select count(*) as "Ready (should be 1)" from pg_proc where pronamespace = 'public'::regnamespace and proname = 'price_request_score_auto';
