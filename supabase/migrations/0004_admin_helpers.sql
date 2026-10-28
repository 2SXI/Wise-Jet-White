-- =====================================================================
-- 0004 — helpers for the admin dashboard
-- =====================================================================

-- Browser code can't create logins (needs the service-role key). Staff create the user in
-- Supabase Authentication, then link that login to a client here, by email.
create function public.staff_link_user_by_email(p_email text, p_client_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if not private.is_staff() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'Client not found'; end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email)) and role = 'client';
  if v_user is null then
    raise exception 'No client login found for that email. Create the user in Supabase Authentication first.';
  end if;
  update public.profiles set client_id = p_client_id where id = v_user;
  return v_user;
end $$;

-- Manual payment-status changes (a gateway webhook would use the service role instead).
-- pending -> paid | failed,  failed -> pending,  paid -> refunded.
create function public.set_payment_status(p_payment_id uuid, p_status public.payment_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.payment_status;
begin
  if not private.is_staff() then raise exception 'Not allowed'; end if;
  select status into v_old from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not ((v_old = 'pending' and p_status in ('paid','failed'))
       or (v_old = 'failed'  and p_status = 'pending')
       or (v_old = 'paid'    and p_status = 'refunded')) then
    raise exception 'A % payment cannot become %', v_old, p_status;
  end if;
  update public.payments set status = p_status where id = p_payment_id;
end $$;

revoke all on function public.staff_link_user_by_email(text, uuid), public.set_payment_status(uuid, public.payment_status) from public, anon;
grant execute on function public.staff_link_user_by_email(text, uuid), public.set_payment_status(uuid, public.payment_status) to authenticated;
