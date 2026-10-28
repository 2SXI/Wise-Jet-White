-- =====================================================================
-- SXI Digital portal — 0002 security, integrity and business rules
--
-- Security model
--  * Every table has RLS enabled. The `anon` role has NO access at all.
--  * `authenticated` users are clients, staff or admin (profiles.role).
--  * Clients get SELECT on their own client's rows only. Their few writes
--    (open a ticket, reply, mark notifications read) are narrowly scoped,
--    everything else goes through SECURITY DEFINER functions that check
--    ownership explicitly and are audited.
--  * Roles are never taken from signup metadata and cannot be changed
--    through the table API (column grants) — only via admin_update_profile().
--  * Secrets (API keys, SSH, root passwords) are not stored here at all.
-- =====================================================================

-- ---------- helpers (used by RLS policies) ---------------------------
create function private.user_role() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.user_role() in ('staff','admin'), false)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.user_role() = 'admin', false)
$$;

-- The client a logged-in *client user* belongs to. NULL for staff, for
-- inactive users and for archived clients, so all client policies fail closed.
create function private.current_client_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.client_id
  from public.profiles p
  join public.clients c on c.id = p.client_id
  where p.id = auth.uid() and p.is_active and p.role = 'client' and c.status <> 'archived'
$$;

create function private.next_invoice_number() returns text
language sql volatile security definer set search_path = public, pg_temp as $$
  select 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0')
$$;
alter table public.invoices alter column number set default private.next_invoice_number();

-- ---------- generic triggers -----------------------------------------
create function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','profiles','servers','services','domains','hosting_accounts',
                           'websites','email_accounts','invoices','payments','support_tickets','settings']
  loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- new auth user -> profile ---------------------------------
-- Role is ALWAYS 'client' with no client link. Metadata supplied at signup
-- is never trusted for role or client_id.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 200))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_user_email();

-- ---------- notifications --------------------------------------------
create function private.notify_client(
  p_client uuid, p_type public.notification_type, p_title text,
  p_body text default null, p_link text default null, p_dedupe text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, client_id, type, title, body, link, dedupe_key)
  select p.id, p_client, p_type, p_title, p_body, p_link, p_dedupe
  from public.profiles p
  where p.client_id = p_client and p.role = 'client' and p.is_active
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;

-- Tells staff: the assigned person if there is one, otherwise every active staff/admin.
create function private.notify_staff(
  p_client uuid, p_assigned uuid, p_type public.notification_type, p_title text,
  p_body text default null, p_link text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, client_id, type, title, body, link)
  select p.id, p_client, p_type, p_title, p_body, p_link
  from public.profiles p
  where p.is_active and p.role in ('staff','admin')
    and (p_assigned is null or p.id = p_assigned);
end $$;

-- ---------- audit log ------------------------------------------------
-- Records WHO changed WHAT: column names and status transitions only —
-- never the values of other columns, so the log can't leak data.
-- Args: (client_visible boolean, comma-separated columns to ignore)
create function private.audit_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_visible boolean := coalesce(tg_argv[0], 'false')::boolean;
  v_ignore text[] := string_to_array(coalesce(tg_argv[1], ''), ',') || array['updated_at'];
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
  v_client uuid;
  v_actor uuid := auth.uid();
  v_role text;
  v_ip text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key) and n.key <> all (v_ignore);
    if v_changed is null then return null; end if;   -- nothing worth logging
    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
    if 'status' = any (v_changed) then
      v_meta := v_meta || jsonb_build_object('from', v_old->>'status', 'to', v_new->>'status');
    end if;
  end if;

  v_client := case tg_table_name when 'clients' then (v_row->>'id')::uuid
              else nullif(v_row->>'client_id', '')::uuid end;

  -- Draft invoices (and drafts that get cancelled) must stay invisible to clients.
  if tg_table_name = 'invoices' and (
       coalesce(v_row->>'status','') = 'draft'
       or (tg_op = 'UPDATE' and v_old->>'status' = 'draft' and v_new->>'status' = 'cancelled')
  ) then v_visible := false; end if;

  select role::text into v_role from public.profiles where id = v_actor;
  begin
    v_ip := nullif(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1), '');
  exception when others then v_ip := null;
  end;

  insert into public.activity_logs (actor_id, actor_role, client_id, action, entity_type, entity_id, metadata, ip, client_visible)
  values (v_actor, coalesce(v_role, case when v_actor is null then 'system' end),
          v_client, tg_table_name || '.' || lower(tg_op), tg_table_name, (v_row->>'id')::uuid,
          v_meta, v_ip, v_visible);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('clients',          'false', ''),
    ('profiles',         'false', ''),
    ('servers',          'false', ''),
    ('provider_links',   'false', ''),
    ('settings',         'false', ''),
    ('internal_notes',   'false', ''),
    ('services',         'true',  ''),
    ('domains',          'true',  ''),
    ('hosting_accounts', 'true',  'storage_used_mb,bandwidth_used_mb,databases_used,usage_synced_at'),
    ('websites',         'true',  ''),
    ('email_accounts',   'true',  'storage_used_mb'),
    ('invoices',         'true',  'subtotal_cents,total_cents'),
    ('invoice_items',    'false', ''),
    ('payments',         'true',  ''),
    ('support_tickets',  'true',  '')
  ) as x(tbl, visible, ignore_cols)
  loop
    execute format('create trigger audit_change after insert or update or delete on public.%I
                    for each row execute function private.audit_change(%L, %L)',
                   r.tbl, r.visible, r.ignore_cols);
  end loop;
end $$;

-- The log is append-only for everyone, service role included.
create function private.activity_logs_immutable() returns trigger language plpgsql as $$
begin raise exception 'activity_logs is append-only'; end $$;
create trigger activity_logs_no_change before update or delete on public.activity_logs
  for each row execute function private.activity_logs_immutable();
create trigger activity_logs_no_truncate before truncate on public.activity_logs
  for each statement execute function private.activity_logs_immutable();

-- ---------- invoices: integrity --------------------------------------
create function private.recalc_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sum bigint;
begin
  select coalesce(sum(round(quantity * unit_price_cents)), 0)::bigint into v_sum
  from public.invoice_items where invoice_id = p_invoice;
  update public.invoices set subtotal_cents = v_sum, total_cents = v_sum where id = p_invoice;
end $$;

create function private.invoice_items_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.recalc_invoice(case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end);
  return null;
end $$;
create trigger invoice_items_recalc after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_after();

-- Line items may only change while the invoice is a draft.
create function private.invoice_items_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status public.invoice_status; v_id uuid;
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A line item cannot move to another invoice';
  end if;
  v_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.invoices where id = v_id;
  -- v_status is null when the parent invoice is itself being deleted (cascade)
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Invoice % is no longer a draft; its items are locked', v_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger invoice_items_guard before insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_guard();

create function private.invoice_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_items int;
begin
  if new.number is distinct from old.number then
    raise exception 'Invoice numbers cannot be changed';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'draft'   and new.status in ('sent','cancelled'))
      or (old.status = 'sent'    and new.status in ('paid','overdue','cancelled'))
      or (old.status = 'overdue' and new.status in ('paid','cancelled'))
    ) then
      raise exception 'Invalid invoice status change: % -> %', old.status, new.status;
    end if;

    if new.status = 'paid' and coalesce(current_setting('app.invoice_paid_ok', true), '') <> '1' then
      raise exception 'Invoices become paid by recording a payment, not by editing the status';
    end if;

    if new.status = 'sent' then
      select count(*) into v_items from public.invoice_items where invoice_id = new.id;
      if v_items = 0 or new.total_cents <= 0 then
        raise exception 'An invoice needs at least one item and a total above zero before it can be sent';
      end if;
      new.sent_at := now();
    elsif new.status = 'paid' then
      new.paid_at := now();
    end if;
  end if;

  -- Once an invoice leaves draft its money fields are frozen.
  if old.status <> 'draft' and (
       new.client_id <> old.client_id or new.currency <> old.currency
    or new.subtotal_cents <> old.subtotal_cents or new.total_cents <> old.total_cents
    or new.issue_date <> old.issue_date
  ) then
    raise exception 'Invoice % is locked after it has been sent', old.number;
  end if;
  return new;
end $$;
create trigger invoice_guard before update on public.invoices
  for each row execute function private.invoice_guard();

create function private.invoice_after_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'sent' and old.status = 'draft' then
    perform private.notify_client(new.client_id, 'invoice_created',
      'New invoice ' || new.number,
      'Due ' || to_char(new.due_date, 'DD Mon YYYY'), '/dashboard/invoices',
      'invoice_sent:' || new.id);
  elsif new.status = 'overdue' then
    perform private.notify_client(new.client_id, 'invoice_overdue',
      'Invoice ' || new.number || ' is overdue',
      'It was due on ' || to_char(new.due_date, 'DD Mon YYYY'), '/dashboard/invoices',
      'invoice_overdue:' || new.id);
  end if;
  return null;
end $$;
create trigger invoice_after_status after update of status on public.invoices
  for each row when (old.status is distinct from new.status)
  execute function private.invoice_after_status();

-- ---------- payments -------------------------------------------------
create function private.payment_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv public.invoices; v_paid bigint;
begin
  select * into v_inv from public.invoices where id = new.invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  if new.client_id <> v_inv.client_id then raise exception 'Payment client does not match the invoice'; end if;
  if new.currency <> v_inv.currency then raise exception 'Payment currency (%) does not match the invoice (%)', new.currency, v_inv.currency; end if;
  if tg_op = 'INSERT' and v_inv.status in ('draft','cancelled') then
    raise exception 'Cannot take a payment against a % invoice', v_inv.status;
  end if;
  if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.amount_cents <> old.amount_cents
                           or new.currency <> old.currency or new.client_id <> old.client_id) then
    raise exception 'Payment invoice, client, amount and currency cannot be edited';
  end if;

  if new.status = 'paid' then
    select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments
    where invoice_id = new.invoice_id and status = 'paid' and id is distinct from new.id;
    if v_paid + new.amount_cents > v_inv.total_cents then
      raise exception 'Payment would exceed the invoice total';
    end if;
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
create trigger payment_guard before insert or update on public.payments
  for each row execute function private.payment_guard();

create function private.payment_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv public.invoices; v_paid bigint;
begin
  if new.status <> 'paid' then return null; end if;
  select * into v_inv from public.invoices where id = new.invoice_id for update;
  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payments where invoice_id = new.invoice_id and status = 'paid';

  perform private.notify_client(new.client_id, 'payment_received',
    'Payment received',
    'Thank you — we received ' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00') || ' ' || new.currency
      || ' for invoice ' || v_inv.number, '/dashboard/invoices',
    'payment:' || new.id);

  if v_paid >= v_inv.total_cents and v_inv.status in ('sent','overdue') then
    perform set_config('app.invoice_paid_ok', '1', true);
    update public.invoices set status = 'paid' where id = v_inv.id;
    perform set_config('app.invoice_paid_ok', '0', true);
  end if;
  return null;
end $$;
create trigger payment_apply after insert or update of status on public.payments
  for each row execute function private.payment_apply();

-- ---------- websites / email: notify on change -----------------------
create function private.website_after_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.notify_client(new.client_id, 'website_status',
    new.name || ' is now ' || new.status::text, null, '/dashboard/websites');
  return null;
end $$;
create trigger website_after_status after update of status on public.websites
  for each row when (old.status is distinct from new.status)
  execute function private.website_after_status();

create function private.email_after_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify_client(new.client_id, 'email_service',
      'Mailbox ' || new.address || ' was added', null, '/dashboard/email');
  elsif new.status is distinct from old.status then
    perform private.notify_client(new.client_id, 'email_service',
      'Mailbox ' || new.address || ' is now ' || new.status::text, null, '/dashboard/email');
  end if;
  return null;
end $$;
create trigger email_after_change after insert or update of status on public.email_accounts
  for each row execute function private.email_after_change();

-- ---------- support tickets ------------------------------------------
create function private.ticket_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if private.user_role() = 'client' then     -- clients cannot pre-set workflow fields
      new.status := 'open'; new.assigned_to := null; new.closed_at := null;
    end if;
  else
    if new.client_id <> old.client_id or new.created_by <> old.created_by then
      raise exception 'Ticket owner cannot be changed';
    end if;
    if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now();
    elsif old.status = 'closed' and new.status <> 'closed' then new.closed_at := null; end if;
  end if;

  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from public.profiles
                   where id = new.assigned_to and role in ('staff','admin') and is_active) then
      raise exception 'Tickets can only be assigned to active staff';
    end if;
  end if;
  return new;
end $$;
create trigger ticket_guard before insert or update on public.support_tickets
  for each row execute function private.ticket_guard();

create function private.ticket_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if private.user_role() = 'client' then
    perform private.notify_staff(new.client_id, null, 'ticket_update',
      'New ticket: ' || new.subject, null, '/admin/support/' || new.id);
  end if;
  return null;
end $$;
create trigger ticket_after_insert after insert on public.support_tickets
  for each row execute function private.ticket_after_insert();

create function private.ticket_after_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.in_message', true), '') = '1' then return null; end if;

  if new.status is distinct from old.status then
    if private.user_role() = 'client' then
      if new.assigned_to is not null then
        perform private.notify_staff(new.client_id, new.assigned_to, 'ticket_update',
          'Ticket ' || new.status::text || ': ' || new.subject, null, '/admin/support/' || new.id);
      end if;
    else
      perform private.notify_client(new.client_id, 'ticket_update',
        'Ticket status: ' || replace(new.status::text, '_', ' '), new.subject, '/dashboard/support/' || new.id);
    end if;
  end if;

  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
    insert into public.notifications (user_id, client_id, type, title, body, link)
    values (new.assigned_to, new.client_id, 'ticket_update', 'Ticket assigned to you', new.subject, '/admin/support/' || new.id);
  end if;
  return null;
end $$;
create trigger ticket_after_update after update on public.support_tickets
  for each row execute function private.ticket_after_update();

create function private.message_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.author_id;
  new.author_role := coalesce(p.role, 'client');
  new.author_name := coalesce(nullif(p.full_name, ''), p.email, 'Support');
  return new;
end $$;
create trigger message_before before insert on public.support_messages
  for each row execute function private.message_before();

create function private.message_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.support_tickets; v_status public.ticket_status;
begin
  select * into t from public.support_tickets where id = new.ticket_id for update;
  if new.author_role = 'client' then
    v_status := case when t.status in ('waiting_for_client','resolved') then 'open' else t.status end;
  else
    v_status := case when t.status = 'open' then 'in_progress' else t.status end;
  end if;

  perform set_config('app.in_message', '1', true);
  update public.support_tickets set status = v_status, updated_at = now() where id = t.id;
  perform set_config('app.in_message', '0', true);

  if new.author_role = 'client' then
    perform private.notify_staff(t.client_id, t.assigned_to, 'ticket_update',
      'New reply: ' || t.subject, null, '/admin/support/' || t.id);
  else
    perform private.notify_client(t.client_id, 'ticket_update',
      'New reply on your ticket', t.subject, '/dashboard/support/' || t.id);
  end if;
  return null;
end $$;
create trigger message_after after insert on public.support_messages
  for each row execute function private.message_after();

-- =====================================================================
-- Row Level Security
-- (select private.fn()) is deliberate: it makes Postgres evaluate the
-- function once per query instead of once per row.
-- =====================================================================
alter table public.clients          enable row level security;
alter table public.profiles         enable row level security;
alter table public.servers          enable row level security;
alter table public.provider_links   enable row level security;
alter table public.services         enable row level security;
alter table public.domains          enable row level security;
alter table public.hosting_accounts enable row level security;
alter table public.websites         enable row level security;
alter table public.email_accounts   enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_items    enable row level security;
alter table public.payments         enable row level security;
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;
alter table public.internal_notes   enable row level security;
alter table public.notifications    enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.settings         enable row level security;
alter table private.rate_limits     enable row level security;

-- clients
create policy clients_select on public.clients for select to authenticated
  using ((select private.is_staff()) or id = (select private.current_client_id()));
create policy clients_insert on public.clients for insert to authenticated
  with check ((select private.is_staff()));
create policy clients_update on public.clients for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy clients_delete on public.clients for delete to authenticated
  using ((select private.is_admin()));

-- profiles: own row for everyone, all rows for staff. Writes: own name/phone only (column grants).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- client-scoped operational tables: clients read own rows, staff manage everything
do $$
declare t text;
begin
  foreach t in array array['services','domains','hosting_accounts','websites'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                    using ((select private.is_staff()) or client_id = (select private.current_client_id()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
                    with check ((select private.is_staff()))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
                    using ((select private.is_staff())) with check ((select private.is_staff()))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
                    using ((select private.is_staff()))', t);
  end loop;
end $$;

-- mailboxes: clients don't see ones already deleted
create policy email_accounts_select on public.email_accounts for select to authenticated
  using ((select private.is_staff())
         or (client_id = (select private.current_client_id()) and status <> 'deleted'));
create policy email_accounts_insert on public.email_accounts for insert to authenticated
  with check ((select private.is_staff()));
create policy email_accounts_update on public.email_accounts for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy email_accounts_delete on public.email_accounts for delete to authenticated
  using ((select private.is_staff()));

-- invoices: clients never see drafts
create policy invoices_select on public.invoices for select to authenticated
  using ((select private.is_staff())
         or (client_id = (select private.current_client_id()) and status <> 'draft'));
create policy invoices_insert on public.invoices for insert to authenticated
  with check ((select private.is_staff()) and status = 'draft');
create policy invoices_update on public.invoices for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy invoices_delete on public.invoices for delete to authenticated
  using ((select private.is_staff()) and status = 'draft');

create policy invoice_items_select on public.invoice_items for select to authenticated
  using ((select private.is_staff())
         or exists (select 1 from public.invoices i
                    where i.id = invoice_id and i.status <> 'draft'
                      and i.client_id = (select private.current_client_id())));
create policy invoice_items_insert on public.invoice_items for insert to authenticated
  with check ((select private.is_staff()));
create policy invoice_items_update on public.invoice_items for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy invoice_items_delete on public.invoice_items for delete to authenticated
  using ((select private.is_staff()));

-- payments: read-only over the API. Rows are created by mark_invoice_paid() or by
-- a payment-provider webhook using the service role.
create policy payments_select on public.payments for select to authenticated
  using ((select private.is_staff()) or client_id = (select private.current_client_id()));

-- support
create policy tickets_select on public.support_tickets for select to authenticated
  using ((select private.is_staff()) or client_id = (select private.current_client_id()));
create policy tickets_insert on public.support_tickets for insert to authenticated
  with check (created_by = (select auth.uid())
              and ((select private.is_staff()) or client_id = (select private.current_client_id())));
create policy tickets_update on public.support_tickets for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy messages_select on public.support_messages for select to authenticated
  using ((select private.is_staff())
         or exists (select 1 from public.support_tickets t
                    where t.id = ticket_id and t.client_id = (select private.current_client_id())));
create policy messages_insert on public.support_messages for insert to authenticated
  with check (author_id = (select auth.uid())
              and ((select private.is_staff())
                   or exists (select 1 from public.support_tickets t
                              where t.id = ticket_id and t.status <> 'closed'
                                and t.client_id = (select private.current_client_id()))));

-- staff-only
create policy internal_notes_select on public.internal_notes for select to authenticated
  using ((select private.is_staff()));
create policy internal_notes_insert on public.internal_notes for insert to authenticated
  with check ((select private.is_staff()) and author_id = (select auth.uid()));
create policy internal_notes_delete on public.internal_notes for delete to authenticated
  using ((select private.is_admin()));

create policy provider_links_all on public.provider_links for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy servers_select on public.servers for select to authenticated
  using ((select private.is_staff()));
create policy servers_write on public.servers for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy settings_admin on public.settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- notifications: strictly personal
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- activity: staff see everything; clients see only rows flagged client_visible for their client
create policy activity_select on public.activity_logs for select to authenticated
  using ((select private.is_staff())
         or (client_visible and client_id = (select private.current_client_id())));

-- =====================================================================
-- Privileges (defence in depth on top of RLS)
-- =====================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
-- future tables/functions created by this role are private by default
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.user_role(), private.is_staff(), private.is_admin(),
                          private.current_client_id(), private.next_invoice_number()
  to authenticated;

grant usage on schema public to anon, authenticated;

-- read access (RLS decides which rows)
grant select on public.clients, public.profiles, public.servers, public.provider_links,
                public.services, public.domains, public.hosting_accounts, public.websites,
                public.email_accounts, public.invoices, public.invoice_items, public.payments,
                public.support_tickets, public.support_messages, public.internal_notes,
                public.notifications, public.activity_logs, public.settings
  to authenticated;

-- staff/admin writes (RLS restricts these to staff/admin; clients have no matching policies)
grant insert, update, delete on public.clients, public.servers, public.provider_links,
                                public.services, public.domains, public.hosting_accounts,
                                public.websites, public.email_accounts, public.invoices,
                                public.invoice_items, public.settings
  to authenticated;
grant insert on public.internal_notes to authenticated;
grant delete on public.internal_notes to authenticated;               -- admin only via RLS
grant insert, update on public.support_tickets to authenticated;
grant insert on public.support_messages to authenticated;
grant usage on sequence public.invoice_number_seq to authenticated;   -- for the number default

-- Column-level limits. Nobody can change their own role / client / active flag
-- through the table API — that only happens in admin_update_profile().
grant update (full_name, phone) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- =====================================================================
-- Privileged actions (SECURITY DEFINER, explicit checks, audited by triggers)
-- Unknown and not-yours look identical ("not found") so ids can't be probed.
-- =====================================================================
create function public.set_domain_auto_renew(p_domain_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client uuid;
begin
  select client_id into v_client from public.domains where id = p_domain_id;
  -- coalesce: a caller with no client must fail closed (NULL comparisons would otherwise skip the check)
  if v_client is null or not (private.is_staff() or coalesce(v_client = private.current_client_id(), false)) then
    raise exception 'Domain not found';
  end if;
  update public.domains set auto_renew = p_enabled where id = p_domain_id;
end $$;

create function public.close_ticket(p_ticket_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client uuid; v_status public.ticket_status;
begin
  select client_id, status into v_client, v_status from public.support_tickets where id = p_ticket_id;
  if v_client is null or not (private.is_staff() or coalesce(v_client = private.current_client_id(), false)) then
    raise exception 'Ticket not found';
  end if;
  if v_status = 'closed' then return; end if;
  update public.support_tickets set status = 'closed' where id = p_ticket_id;
end $$;

create function public.send_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_staff() then raise exception 'Not allowed'; end if;
  update public.invoices set status = 'sent' where id = p_invoice_id and status = 'draft';
  if not found then raise exception 'Only draft invoices can be sent'; end if;
end $$;

-- Records the remaining balance as a manual payment; the payment trigger then marks the invoice paid.
create function public.mark_invoice_paid(p_invoice_id uuid, p_method text, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv public.invoices; v_paid bigint; v_id uuid;
begin
  if not private.is_staff() then raise exception 'Not allowed'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or v_inv.status not in ('sent','overdue') then
    raise exception 'Only sent or overdue invoices can be marked as paid';
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payments where invoice_id = p_invoice_id and status = 'paid';
  if v_inv.total_cents - v_paid <= 0 then raise exception 'Invoice is already fully paid'; end if;

  insert into public.payments (invoice_id, client_id, provider, provider_reference, method,
                               amount_cents, currency, status, created_by)
  values (p_invoice_id, v_inv.client_id, 'manual', nullif(trim(p_reference), ''), nullif(trim(p_method), ''),
          v_inv.total_cents - v_paid, v_inv.currency, 'paid', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Staff can attach a client-role user to a client (used when inviting client users).
create function public.staff_assign_user_to_client(p_user_id uuid, p_client_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_staff() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'Client not found'; end if;
  update public.profiles set client_id = p_client_id where id = p_user_id and role = 'client';
  if not found then raise exception 'User not found or not a client user'; end if;
end $$;

-- Only admins change roles. Guards against locking everyone out.
create function public.admin_update_profile(
  p_user_id uuid, p_role public.user_role, p_client_id uuid default null, p_is_active boolean default true
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admins int;
begin
  if not private.is_admin() then raise exception 'Not allowed'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_is_active) then
    raise exception 'You cannot demote or deactivate yourself';
  end if;
  if p_role <> 'client' and p_client_id is not null then
    raise exception 'Staff and admins do not belong to a client';
  end if;

  update public.profiles
     set role = p_role,
         client_id = case when p_role = 'client' then p_client_id else null end,
         is_active = p_is_active
   where id = p_user_id;
  if not found then raise exception 'User not found'; end if;

  select count(*) into v_admins from public.profiles where role = 'admin' and is_active;
  if v_admins = 0 then raise exception 'There must always be at least one active admin'; end if;
end $$;

-- Functions are executable by PUBLIC by default in Postgres, and the blanket revoke near the top of
-- this file ran before these functions existed — so revoke explicitly, then grant to signed-in users only.
revoke all on function
  public.set_domain_auto_renew(uuid, boolean), public.close_ticket(uuid),
  public.send_invoice(uuid), public.mark_invoice_paid(uuid, text, text),
  public.staff_assign_user_to_client(uuid, uuid),
  public.admin_update_profile(uuid, public.user_role, uuid, boolean)
  from public, anon;
grant execute on function
  public.set_domain_auto_renew(uuid, boolean), public.close_ticket(uuid),
  public.send_invoice(uuid), public.mark_invoice_paid(uuid, text, text),
  public.staff_assign_user_to_client(uuid, uuid),
  public.admin_update_profile(uuid, public.user_role, uuid, boolean)
  to authenticated;

-- =====================================================================
-- Server-side only (service role): rate limiting, app-level audit events,
-- and the daily maintenance job (overdue invoices + renewal reminders).
-- =====================================================================
create function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_hits int;
begin
  insert into private.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

create function public.log_activity(
  p_action text, p_actor uuid default null, p_client_id uuid default null,
  p_entity_type text default null, p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_ip text default null, p_client_visible boolean default false
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.activity_logs (actor_id, actor_role, client_id, action, entity_type, entity_id, metadata, ip, client_visible)
  values (p_actor, (select role::text from public.profiles where id = p_actor), p_client_id,
          left(p_action, 100), p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), left(p_ip, 64), p_client_visible);
end $$;

create function public.run_daily_maintenance() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_days int; v_bucket int; v_overdue int := 0; v_due int := 0; v_dom int := 0; v_host int := 0;
begin
  -- 1. sent invoices past their due date become overdue (the trigger notifies the client)
  with u as (update public.invoices set status = 'overdue'
             where status = 'sent' and due_date < current_date returning 1)
  select count(*) into v_overdue from u;

  -- 2. invoices falling due within 3 days
  for r in select id, client_id, number, due_date from public.invoices
           where status = 'sent' and due_date between current_date and current_date + 3 loop
    perform private.notify_client(r.client_id, 'invoice_due', 'Invoice ' || r.number || ' is due soon',
      'Due ' || to_char(r.due_date, 'DD Mon YYYY'), '/dashboard/invoices', 'invoice_due:' || r.id);
    v_due := v_due + 1;
  end loop;

  -- 3. domain expiry: one reminder per bucket (30 / 14 / 7 days, then expired)
  for r in select id, client_id, name, expires_at, auto_renew from public.domains
           where status in ('active','expired') and expires_at is not null
             and expires_at <= current_date + 30 loop
    v_days := r.expires_at - current_date;
    v_bucket := case when v_days < 0 then 0 when v_days <= 7 then 7 when v_days <= 14 then 14 else 30 end;
    perform private.notify_client(r.client_id, 'domain_expiring',
      case when v_days < 0 then r.name || ' has expired'
           else r.name || ' expires in ' || v_days || ' day' || case when v_days = 1 then '' else 's' end end,
      case when r.auto_renew then 'Auto-renew is on.' else 'Auto-renew is off — renew to keep the domain.' end,
      '/dashboard/domains', 'domain:' || r.id || ':' || r.expires_at || ':' || v_bucket);
    v_dom := v_dom + 1;
  end loop;

  -- 4. hosting renewals
  for r in select id, client_id, plan_name, renewal_date from public.hosting_accounts
           where status = 'active' and renewal_date is not null and renewal_date <= current_date + 30 loop
    v_days := r.renewal_date - current_date;
    v_bucket := case when v_days < 0 then 0 when v_days <= 7 then 7 when v_days <= 14 then 14 else 30 end;
    perform private.notify_client(r.client_id, 'hosting_renewal',
      'Hosting renews ' || case when v_days < 0 then 'was due ' || to_char(r.renewal_date, 'DD Mon YYYY')
                                when v_days = 0 then 'today' else 'in ' || v_days || ' days' end,
      r.plan_name, '/dashboard/hosting', 'hosting:' || r.id || ':' || r.renewal_date || ':' || v_bucket);
    v_host := v_host + 1;
  end loop;

  delete from private.rate_limits where window_start < now() - interval '1 day';
  return jsonb_build_object('invoices_marked_overdue', v_overdue, 'invoice_due_checked', v_due,
                            'domains_checked', v_dom, 'hosting_checked', v_host);
end $$;

revoke all on function public.rate_limit_hit(text, int, int), public.log_activity(text, uuid, uuid, text, uuid, jsonb, text, boolean),
  public.run_daily_maintenance() from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int), public.log_activity(text, uuid, uuid, text, uuid, jsonb, text, boolean),
  public.run_daily_maintenance() to service_role;
