-- =====================================================================
-- 0003 — helpers for the browser-based client dashboard
-- =====================================================================

-- Opens a ticket and its first message atomically, for the signed-in CLIENT user.
-- client_id always comes from the session, never from the caller.
create function public.create_ticket(
  p_subject text, p_body text,
  p_category public.ticket_category default 'general',
  p_priority public.ticket_priority default 'normal',
  p_related_type text default null, p_related_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client uuid := private.current_client_id(); v_id uuid; v_ok boolean;
begin
  if v_client is null then raise exception 'Not allowed'; end if;
  if (p_related_type is null) <> (p_related_id is null) then
    raise exception 'Related item needs both a type and an id';
  end if;

  if p_related_type is not null then
    v_ok := case p_related_type
      when 'website'       then exists (select 1 from public.websites        where id = p_related_id and client_id = v_client)
      when 'domain'        then exists (select 1 from public.domains         where id = p_related_id and client_id = v_client)
      when 'hosting'       then exists (select 1 from public.hosting_accounts where id = p_related_id and client_id = v_client)
      when 'email_account' then exists (select 1 from public.email_accounts  where id = p_related_id and client_id = v_client)
      when 'invoice'       then exists (select 1 from public.invoices        where id = p_related_id and client_id = v_client and status <> 'draft')
      else false end;
    if not v_ok then raise exception 'Related item not found'; end if;
  end if;

  insert into public.support_tickets (client_id, created_by, subject, category, priority, related_type, related_id)
  values (v_client, auth.uid(), trim(p_subject), p_category,
          case when p_priority = 'urgent' then 'high' else p_priority end,   -- clients can't self-declare urgent
          p_related_type, p_related_id)
  returning id into v_id;

  insert into public.support_messages (ticket_id, author_id, body) values (v_id, auth.uid(), p_body);
  return v_id;
end $$;

-- Lets a signed-in user record their own sign-in/out in the audit log (allow-listed events only).
create function public.log_own_event(p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip text;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  if p_action not in ('auth.login', 'auth.logout', 'auth.password_changed') then raise exception 'Unknown event'; end if;
  -- flood guard: one identical event per 5 seconds per user
  if exists (select 1 from public.activity_logs
             where actor_id = auth.uid() and action = p_action and created_at > now() - interval '5 seconds') then
    return;
  end if;
  begin
    v_ip := nullif(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1), '');
  exception when others then v_ip := null;
  end;
  insert into public.activity_logs (actor_id, actor_role, client_id, action, ip, client_visible)
  select p.id, p.role::text, p.client_id, p_action, v_ip, false from public.profiles p where p.id = auth.uid();
end $$;

revoke all on function public.create_ticket(text, text, public.ticket_category, public.ticket_priority, text, uuid),
                       public.log_own_event(text) from public, anon;
grant execute on function public.create_ticket(text, text, public.ticket_category, public.ticket_priority, text, uuid),
                          public.log_own_event(text) to authenticated;
