-- 0092: price approvers can edit a price request after it's answered.
--  * price_request_edit(): fix the customer's details, the good-through date and the rep's note.
--  * price_request_decide(): same as before, plus a line changed to "No" takes back the customer price it gave.
-- Safe to run again.

create or replace function public.price_request_edit(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $fn$
declare k text; v_cust jsonb; v_first text; v_last text;
begin
  if not public.has_perm('prf_approve') then raise exception 'Only price approvers can do that.'; end if;
  select coalesce(customer, '{}'::jsonb) into v_cust from public.price_requests where id = p_id;
  if not found then raise exception 'Price request not found.'; end if;
  foreach k in array array['legal_name', 'contact_first', 'contact_last', 'email', 'phone', 'street', 'city', 'state', 'zip'] loop
    if p ? k then v_cust := v_cust || jsonb_build_object(k, left(trim(coalesce(p ->> k, '')), 200)); end if;
  end loop;
  v_first := nullif(trim(coalesce(p ->> 'contact_first', '')), '');
  v_last := nullif(trim(coalesce(p ->> 'contact_last', '')), '');
  update public.price_requests
     set customer = v_cust,
         company_name = coalesce(nullif(left(trim(coalesce(p ->> 'legal_name', '')), 200), ''), company_name),
         contact = case when p ? 'contact_first' or p ? 'contact_last' then nullif(concat_ws(' ', v_first, v_last), '') else contact end,
         valid_until = case when p ? 'valid_until' then nullif(p ->> 'valid_until', '')::date else valid_until end,
         note = case when p ? 'note' then nullif(left(trim(coalesce(p ->> 'note', '')), 2000), '') else note end
   where id = p_id;
  -- Approved prices carry the new good-through date.
  if p ? 'valid_until' then
    update public.customer_prices cp set expires_on = r.valid_until
      from public.price_requests r
     where r.id = p_id and cp.company_id = r.company_id and cp.source = 'price_request' and cp.source_ref = 'PRF-' || p_id;
  end if;
end $fn$;

create or replace function public.price_request_decide(p_id bigint, p_lines jsonb, p_note text) returns text
language plpgsql security definer set search_path = public as $fn$
declare ln jsonb; v_name text; v_p int; v_a int; v_d int; v_status text;
begin
  if not public.has_perm('prf_approve') then raise exception 'Only price approvers can do that.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.price_request_lines
       set status = case when ln ->> 'status' = 'denied' then 'denied' else 'approved' end,
           approved_price = case when ln ->> 'status' = 'denied' then null else round(coalesce(nullif(ln ->> 'price', '')::numeric, requested_price), 4) end,
           auto = false, rule = null
     where id = (ln ->> 'id')::bigint and request_id = p_id;
  end loop;
  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved'), count(*) filter (where status = 'denied')
    into v_p, v_a, v_d from public.price_request_lines where request_id = p_id;
  v_status := case when v_p > 0 then 'pending' when v_d = 0 then 'approved' when v_a = 0 then 'denied' else 'partly' end;
  update public.price_requests
     set status = v_status, decided_by_name = case when v_p = 0 then v_name end, decided_at = case when v_p = 0 then now() end,
         decision_note = nullif(left(trim(coalesce(p_note, '')), 2000), '')
   where id = p_id;
  if not found then raise exception 'Price request not found.'; end if;
  if v_status in ('approved', 'partly') then perform public.customer_prices_from_request(p_id); end if;
  -- Changed to "No" after it was approved: take back the customer price this request gave.
  delete from public.customer_prices cp
   using public.price_request_lines l, public.price_requests r
   where l.request_id = p_id and l.status = 'denied' and r.id = p_id
     and cp.company_id = r.company_id and cp.source = 'price_request' and cp.source_ref = 'PRF-' || p_id
     and cp.product_id = any(case when coalesce(cardinality(l.applies_to), 0) > 0 then l.applies_to else array[l.product_id] end);
  return v_status;
end $fn$;

revoke all on function public.price_request_edit(bigint, jsonb) from public, anon;
grant execute on function public.price_request_edit(bigint, jsonb) to authenticated;
revoke all on function public.price_request_decide(bigint, jsonb, text) from public, anon;
grant execute on function public.price_request_decide(bigint, jsonb, text) to authenticated;

-- Check: should say 1
select count(*) as "Ready (should be 1)" from pg_proc where pronamespace = 'public'::regnamespace and proname = 'price_request_edit';
