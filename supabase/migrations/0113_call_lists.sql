-- 0113: Call lists in the Sales CRM.
--  * Each rep gets two lists: Win-back (past customers who stopped ordering) and Cold leads (contractors from BBB and
--    ConstructConnect who never bought). Admins load them from the reviewed Excel file (Sales > My calls > Load lists).
--  * A rep logs each call with one tap (no answer, voicemail, talked, call back on a date, not interested, wrong number,
--    wants to order / interested). Every call is kept in crm_call_log and also saved to the customer's or lead's history.
--  * "Interested" on a cold lead adds it to the New-customer pipeline.
-- Run once in Supabase > SQL Editor. Safe to run again.

create table if not exists public.crm_calls (
  id             bigint generated always as identity primary key,
  list           text not null check (list in ('winback', 'cold')),
  rep_id         uuid references public.profiles(id) on delete set null,
  rep_name       text,
  company_id     uuid references public.companies(id) on delete set null,
  lead_id        uuid references public.crm_leads(id) on delete set null,
  name           text not null,
  contact_name   text,
  phone          text,
  email          text,
  street         text,
  city           text,
  state          text,
  zip            text,
  source         text,
  kind_guess     text,
  priority       text,
  last_invoice   date,
  sales_12mo     numeric(14,2),
  prev_rep       text,
  sheet_note     text,
  status         text not null default 'new' check (status in ('new', 'no_answer', 'voicemail', 'talked', 'callback', 'not_interested', 'wrong_number', 'won')),
  next_on        date,
  touches        int not null default 0,
  last_touch_at  timestamptz,
  last_touch_by  text,
  last_note      text,
  batch          text,
  loaded_by_name text,
  created_at     timestamptz not null default now()
);
create unique index if not exists crm_calls_once on public.crm_calls (list, lower(name), lower(coalesce(city, '')), coalesce(state, ''));
create index if not exists crm_calls_rep on public.crm_calls (rep_id, list, status);
create index if not exists crm_calls_next on public.crm_calls (next_on) where next_on is not null;

create table if not exists public.crm_call_log (
  id        bigint generated always as identity primary key,
  call_id   bigint not null references public.crm_calls(id) on delete cascade,
  outcome   text not null,
  note      text,
  next_on   date,
  by_id     uuid,
  by_name   text,
  at        timestamptz not null default now()
);
create index if not exists crm_call_log_call on public.crm_call_log (call_id, at desc);

alter table public.crm_calls enable row level security;
alter table public.crm_call_log enable row level security;
drop policy if exists crm_calls_read on public.crm_calls;
create policy crm_calls_read on public.crm_calls for select to authenticated
  using (public.can_sales_all() or (public.can_sales_hub() and rep_id = auth.uid()));
drop policy if exists crm_call_log_read on public.crm_call_log;
create policy crm_call_log_read on public.crm_call_log for select to authenticated
  using (exists (select 1 from public.crm_calls c where c.id = call_id and (public.can_sales_all() or (public.can_sales_hub() and c.rep_id = auth.uid()))));

-- Admins: load rows from the reviewed lists. Rows already on a list (same list, name, city and state) are skipped,
-- so loading the same file twice adds nothing. A win-back row is tied to the A.I. customer with that exact name.
create or replace function public.crm_calls_load(p_rows jsonb, p_batch text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare n int; total int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  if not public.is_admin() then raise exception 'Only admins load call lists.'; end if;
  insert into public.crm_calls (list, rep_id, rep_name, company_id, name, contact_name, phone, email, street, city, state, zip, source, kind_guess,
                                priority, last_invoice, sales_12mo, prev_rep, sheet_note, batch, loaded_by_name)
  select r->>'list', p.id, p.full_name,
         case when r->>'list' = 'winback' then (select c.id from public.companies c where lower(c.name) = lower(trim(coalesce(nullif(r->>'company_name', ''), r->>'name'))) order by c.active desc limit 1) end,
         left(trim(r->>'name'), 200), nullif(left(trim(coalesce(r->>'contact_name', '')), 200), ''), nullif(left(trim(coalesce(r->>'phone', '')), 200), ''),
         nullif(left(trim(coalesce(r->>'email', '')), 300), ''), nullif(left(trim(coalesce(r->>'street', '')), 200), ''), nullif(left(trim(coalesce(r->>'city', '')), 100), ''),
         upper(nullif(left(trim(coalesce(r->>'state', '')), 2), '')), nullif(left(trim(coalesce(r->>'zip', '')), 10), ''), nullif(left(trim(coalesce(r->>'source', '')), 60), ''),
         nullif(left(trim(coalesce(r->>'kind_guess', '')), 40), ''), nullif(left(trim(coalesce(r->>'priority', '')), 2), ''),
         case when coalesce(r->>'last_invoice', '') ~ '^\d{4}-\d{2}-\d{2}' then left(r->>'last_invoice', 10)::date end,
         case when coalesce(r->>'sales_12mo', '') ~ '^-?\d+(\.\d+)?$' then (r->>'sales_12mo')::numeric end,
         nullif(left(trim(coalesce(r->>'prev_rep', '')), 100), ''), nullif(left(trim(coalesce(r->>'sheet_note', '')), 1000), ''),
         left(coalesce(p_batch, ''), 60), public.my_name()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    join public.profiles p on p.id = nullif(r->>'rep_id', '')::uuid
   where r->>'list' in ('winback', 'cold') and length(trim(coalesce(r->>'name', ''))) > 1
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('added', n, 'skipped', total - n);
end $fn$;
revoke all on function public.crm_calls_load(jsonb, text) from public, anon;
grant execute on function public.crm_calls_load(jsonb, text) to authenticated;

-- Log one call. p_outcome: no_answer, voicemail, talked, callback, not_interested, wrong_number, won.
-- "won" on a cold lead adds it to the New-customer pipeline (once). Returns the lead id when there is one.
create or replace function public.crm_call_save(p_id bigint, p_outcome text, p_note text default null, p_next date default null) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare c public.crm_calls; ld uuid; words text; label text;
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  select * into c from public.crm_calls where id = p_id;
  if c.id is null then raise exception 'That call isn''t on a list anymore.'; end if;
  if not (public.can_sales_all() or c.rep_id = auth.uid()) then raise exception 'That call is on someone else''s list.'; end if;
  if p_outcome not in ('no_answer', 'voicemail', 'talked', 'callback', 'not_interested', 'wrong_number', 'won') then raise exception 'Pick how the call went.'; end if;
  if p_outcome = 'callback' and p_next is null then raise exception 'Pick the day to call back.'; end if;
  label := case p_outcome when 'no_answer' then 'No answer' when 'voicemail' then 'Left a voicemail' when 'talked' then 'Talked'
             when 'callback' then 'Call back ' || to_char(p_next, 'Mon FMDD') when 'not_interested' then case when c.list = 'cold' then 'Not a fit' else 'Not interested' end
             when 'wrong_number' then 'Wrong number' else case when c.list = 'cold' then 'Interested' else 'Wants to order' end end;
  words := label || coalesce(': ' || nullif(trim(p_note), ''), '');
  insert into public.crm_call_log (call_id, outcome, note, next_on, by_id, by_name)
  values (c.id, p_outcome, nullif(left(trim(coalesce(p_note, '')), 4000), ''), p_next, auth.uid(), public.my_name());
  ld := c.lead_id;
  if p_outcome = 'won' and c.list = 'cold' and ld is null then
    insert into public.crm_leads (name, contact_name, phone, email, city, state, source, notes, rep_id, rep_name, created_by_name)
    values (c.name, c.contact_name, c.phone, c.email, c.city, c.state, coalesce(c.source, 'Cold lead'), nullif(trim(coalesce(p_note, '')), ''),
            coalesce(c.rep_id, auth.uid()), coalesce(c.rep_name, public.my_name()), public.my_name())
    returning id into ld;
  end if;
  update public.crm_calls
     set status = p_outcome, next_on = case when p_outcome in ('not_interested', 'wrong_number', 'won') then null else p_next end,
         touches = touches + 1, last_touch_at = now(), last_touch_by = public.my_name(), last_note = left(words, 500), lead_id = ld
   where id = c.id;
  -- Also keep it in the customer's or lead's history.
  if c.company_id is not null or ld is not null then
    insert into public.crm_activities (company_id, lead_id, kind, body, created_by, created_by_name)
    values (c.company_id, ld, 'call', left((case when c.list = 'winback' then 'Win-back call. ' else 'Cold call. ' end) || words, 4000), auth.uid(), public.my_name());
  end if;
  return jsonb_build_object('lead_id', ld);
end $fn$;
revoke all on function public.crm_call_save(bigint, text, text, date) from public, anon;
grant execute on function public.crm_call_save(bigint, text, text, date) to authenticated;

-- Admins and sales managers: move calls to another rep.
create or replace function public.crm_calls_assign(p_ids bigint[], p_rep uuid) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not public.can_sales_all() then raise exception 'Only admins and sales managers move calls.'; end if;
  update public.crm_calls set rep_id = p_rep, rep_name = (select full_name from public.profiles where id = p_rep) where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.crm_calls_assign(bigint[], uuid) from public, anon;
grant execute on function public.crm_calls_assign(bigint[], uuid) to authenticated;

-- Saved AI briefings and customer write-ups: a rep reads only their own briefing and write-ups on their own customers
-- (admins and sales managers read all). Before this, anyone with the Sales hub could read any of them through the database.
drop policy if exists crm_ai_notes_read on public.crm_ai_notes;
create policy crm_ai_notes_read on public.crm_ai_notes for select to authenticated
  using (public.can_sales_all()
         or (public.can_sales_hub() and kind = 'brief' and key like auth.uid()::text || ':%')
         or (public.can_sales_hub() and case when kind = 'customer' and key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
                                             then public.crm_mine(split_part(key, ':', 1)::uuid) else false end));

notify pgrst, 'reload schema';

-- Check: should say 2.
select count(*) as "Call list tables (2)" from information_schema.tables where table_schema = 'public' and table_name in ('crm_calls', 'crm_call_log');
