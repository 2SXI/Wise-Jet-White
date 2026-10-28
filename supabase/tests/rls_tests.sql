-- =====================================================================
-- Security & business-rule tests. Each check records pass/fail; the run
-- fails (non-zero exit) if anything failed.
-- =====================================================================
create schema t;
grant usage on schema t to public;
create table t.results (n serial, name text, ok boolean, detail text);
create table t.ids (name text primary key, id uuid not null);
grant all on t.results, t.ids to public;
grant usage on sequence t.results_n_seq to public;

create function t.mk(p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); begin insert into t.ids values (p_name, v); return v; end $$;
create function t.id(p_name text) returns uuid language sql stable as $$ select id from t.ids where name = p_name $$;
create function t.check(p_name text, p_ok boolean, p_detail text default null) returns void language plpgsql as $$
begin insert into t.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
create function t.throws(p_name text, p_sql text, p_frag text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    insert into t.results(name, ok, detail) values (p_name, false, 'expected an error but statement succeeded');
  exception when others then
    insert into t.results(name, ok, detail) values (p_name, p_frag is null or sqlerrm ilike '%' || p_frag || '%', sqlerrm);
  end;
end $$;
create function t.n(p_sql text) returns bigint language plpgsql as $$
declare v bigint; begin execute 'select count(*) from (' || p_sql || ') q' into v; return v; end $$;
create function t.val(p_sql text) returns text language plpgsql as $$
declare v text; begin execute p_sql into v; return v; end $$;
create function t.affected(p_sql text) returns int language plpgsql as $$
declare v int; begin execute p_sql; get diagnostics v = row_count; return v; end $$;
-- switch identity the way PostgREST does: JWT subject + database role
create function t.as_user(p_who text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', t.id(p_who)::text, true); set local role authenticated; end $$;
create function t.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', true); set local role service_role; end $$;
create function t.as_root() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
grant execute on all functions in schema t to public;

-- ---------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------
do $$
declare cA uuid := t.mk('cA'); cB uuid := t.mk('cB'); cC uuid := t.mk('cC'); cD uuid := t.mk('cD');
        v_inv uuid;
begin
  insert into public.clients (id, company_name, status) values
    (cA, 'Arikho Suites', 'active'), (cB, 'Blue Ridge Foods', 'active'),
    (cC, 'Archived Co', 'archived'), (cD, 'Empty Co', 'active');

  insert into auth.users (id, email) values
    (t.mk('ua'),  'ua@a.test'),  (t.mk('ua2'), 'ua2@a.test'), (t.mk('ub'), 'ub@b.test'),
    (t.mk('uarch'), 'x@c.test'), (t.mk('uinactive'), 'off@a.test'), (t.mk('uloose'), 'loose@x.test'),
    (t.mk('staff'), 'staff@sxi.test'), (t.mk('staff2'), 'staff2@sxi.test'),
    (t.mk('admin'), 'admin@sxi.test'), (t.mk('admin2'), 'admin2@sxi.test');

  update public.profiles set client_id = cA where id in (t.id('ua'), t.id('ua2'), t.id('uinactive'));
  update public.profiles set client_id = cB where id = t.id('ub');
  update public.profiles set client_id = cC where id = t.id('uarch');
  update public.profiles set is_active = false where id = t.id('uinactive');
  update public.profiles set role = 'staff' where id in (t.id('staff'), t.id('staff2'));
  update public.profiles set role = 'admin' where id in (t.id('admin'), t.id('admin2'));

  insert into public.servers (id, name, ip_address, provider) values (t.mk('srv'), 'sxi-vps-01', '203.0.113.10', 'cloudpanel');

  insert into public.domains (id, client_id, name, status, expires_at, auto_renew) values
    (t.mk('dA'), cA, 'arikhosuites.co.zw', 'active', current_date + 200, false),
    (t.mk('dB'), cB, 'blueridge.co.zw',    'active', current_date + 200, false);
  insert into public.hosting_accounts (id, client_id, server_label, plan_name, status, renewal_date) values
    (t.mk('hA'), cA, 'sxi-vps-01', 'Business', 'active', current_date + 200),
    (t.mk('hB'), cB, 'sxi-vps-01', 'Starter',  'active', current_date + 200);
  insert into public.provider_links (entity_type, entity_id, provider, external_id, server_id)
    values ('hosting_account', t.id('hA'), 'cloudpanel', 'arikho_user', t.id('srv'));
  insert into public.websites (id, client_id, hosting_account_id, domain_id, name, url, status) values
    (t.mk('wA'), cA, t.id('hA'), t.id('dA'), 'Arikho Suites', 'https://arikhosuites.co.zw', 'live'),
    (t.mk('wB'), cB, t.id('hB'), t.id('dB'), 'Blue Ridge',    'https://blueridge.co.zw',    'live');
  insert into public.email_accounts (client_id, domain_id, address, status) values
    (cA, t.id('dA'), 'info@arikhosuites.co.zw',  'active'),
    (cA, t.id('dA'), 'gone@arikhosuites.co.zw',  'deleted'),
    (cB, t.id('dB'), 'info@blueridge.co.zw',     'active');
  insert into public.services (id, client_id, type, name, status, price_cents) values
    (t.mk('sA'), cA, 'hosting', 'Business hosting', 'active', 1500),
    (t.mk('sB'), cB, 'hosting', 'Starter hosting',  'active', 900);

  -- invoices: A has a draft and a sent one; B has a sent one
  insert into public.invoices (id, client_id, due_date) values (t.mk('iAd'), cA, current_date + 14);
  insert into public.invoice_items (invoice_id, description, quantity, unit_price_cents) values (t.id('iAd'), 'Draft item', 1, 1000);
  insert into public.invoices (id, client_id, due_date) values (t.mk('iAs'), cA, current_date + 14);
  insert into public.invoice_items (invoice_id, description, quantity, unit_price_cents) values (t.id('iAs'), 'Hosting', 1, 1500);
  update public.invoices set status = 'sent' where id = t.id('iAs');
  insert into public.invoices (id, client_id, due_date) values (t.mk('iBs'), cB, current_date + 14);
  insert into public.invoice_items (invoice_id, description, quantity, unit_price_cents) values (t.id('iBs'), 'Hosting', 1, 900);
  update public.invoices set status = 'sent' where id = t.id('iBs');

  insert into public.support_tickets (id, client_id, created_by, subject) values
    (t.mk('tA'), cA, t.id('ua'), 'Email not syncing'), (t.mk('tB'), cB, t.id('ub'), 'Change logo');
  insert into public.support_messages (ticket_id, author_id, body) values
    (t.id('tA'), t.id('ua'), 'Help please'), (t.id('tB'), t.id('ub'), 'New logo attached');
  insert into public.internal_notes (entity_type, entity_id, client_id, body, author_id)
    values ('client', cA, cA, 'Pays late, chase on the 5th', t.id('staff'));
  insert into public.settings values ('company', '{"name":"SXI Digital"}');
end $$;

-- ---------------------------------------------------------------------
-- 1. Client isolation (client A user)
-- ---------------------------------------------------------------------
do $$
begin
  perform t.as_user('ua');
  perform t.check('client sees only own company',           t.n('select 1 from public.clients') = 1);
  perform t.check('client sees own domain only',            t.n('select 1 from public.domains') = 1 and t.n($q$select 1 from public.domains where name='blueridge.co.zw'$q$) = 0);
  perform t.check('client sees own hosting only',           t.n('select 1 from public.hosting_accounts') = 1);
  perform t.check('client sees own websites only',          t.n('select 1 from public.websites') = 1);
  perform t.check('client sees own services only',          t.n('select 1 from public.services') = 1);
  perform t.check('client does not see deleted mailboxes',  t.n('select 1 from public.email_accounts') = 1);
  perform t.check('client cannot see draft invoices',       t.n('select 1 from public.invoices') = 1 and t.n(format('select 1 from public.invoices where id=%L', t.id('iAd'))) = 0);
  perform t.check('client cannot see draft invoice items',  t.n(format('select 1 from public.invoice_items where invoice_id=%L', t.id('iAd'))) = 0);
  perform t.check('client sees items of a sent invoice',    t.n(format('select 1 from public.invoice_items where invoice_id=%L', t.id('iAs'))) = 1);
  perform t.check('client cannot see other client invoice', t.n(format('select 1 from public.invoices where id=%L', t.id('iBs'))) = 0);
  perform t.check('client sees only own tickets',           t.n('select 1 from public.support_tickets') = 1);
  perform t.check('client sees only own messages',          t.n('select 1 from public.support_messages') = 1);
  perform t.check('client cannot read internal notes',      t.n('select 1 from public.internal_notes') = 0);
  perform t.check('client cannot read servers',             t.n('select 1 from public.servers') = 0);
  perform t.check('client cannot read provider links',      t.n('select 1 from public.provider_links') = 0);
  perform t.check('client cannot read settings',            t.n('select 1 from public.settings') = 0);
  perform t.check('client only sees own profile',           t.n('select 1 from public.profiles') = 1);
  perform t.check('client only sees own notifications',     t.n(format('select 1 from public.notifications where user_id <> %L', t.id('ua'))) = 0);
  perform t.check('client activity is limited to own client and flagged rows',
                  t.n(format('select 1 from public.activity_logs where client_id is distinct from %L or not client_visible', t.id('cA'))) = 0
                  and t.n('select 1 from public.activity_logs') > 0);
  perform t.check('draft invoice leaves no trace in client activity',
                  t.n(format('select 1 from public.activity_logs where entity_id = %L', t.id('iAd'))) = 0);

  -- anonymous
  perform t.as_anon();
  perform t.throws('anon cannot read clients',  'select * from public.clients', 'permission denied');
  perform t.throws('anon cannot read invoices', 'select * from public.invoices', 'permission denied');
  perform t.throws('anon cannot call RPCs',     format('select public.close_ticket(%L)', t.id('tA')), 'permission denied');
  perform t.as_root();
end $$;

-- ---------------------------------------------------------------------
-- 2. Client write restrictions & escalation attempts
-- ---------------------------------------------------------------------
do $$
declare v_tid uuid;
begin
  perform t.as_user('ua');
  perform t.throws('client cannot insert services',    format($q$insert into public.services (client_id,type,name) values (%L,'other','x')$q$, t.id('cA')), 'row-level security');
  perform t.check('client cannot update domains (0 rows)', t.affected($q$update public.domains set registrar='x'$q$) = 0);
  perform t.check('client cannot delete websites (0 rows)', t.affected('delete from public.websites') = 0);
  perform t.throws('client cannot self-promote to admin',   format($q$update public.profiles set role='admin' where id=%L$q$, t.id('ua')), 'permission denied');
  perform t.throws('client cannot move itself to another client', format('update public.profiles set client_id=%L where id=%L', t.id('cB'), t.id('ua')), 'permission denied');
  perform t.throws('client cannot re-activate itself',      format('update public.profiles set is_active=true where id=%L', t.id('ua')), 'permission denied');
  perform t.check('client can update own name',        t.affected(format($q$update public.profiles set full_name='Arikho Owner' where id=%L$q$, t.id('ua'))) = 1);
  perform t.check('client cannot edit someone else profile', t.affected(format($q$update public.profiles set full_name='pwned' where id=%L$q$, t.id('ub'))) = 0);
  perform t.throws('client cannot write activity log',  $q$insert into public.activity_logs (action) values ('fake')$q$, 'permission denied');
  perform t.throws('client cannot edit activity log',   'update public.activity_logs set action = action', 'permission denied');
  perform t.throws('client cannot insert payments',     format($q$insert into public.payments (invoice_id,client_id,provider,amount_cents,currency,status) values (%L,%L,'x',1,'USD','paid')$q$, t.id('iAs'), t.id('cA')), 'permission denied');
  perform t.throws('client cannot insert invoices',     format($q$insert into public.invoices (client_id,due_date) values (%L,current_date)$q$, t.id('cA')), 'row-level security');

  -- tickets
  perform t.throws('client cannot open ticket for another client',
    format($q$insert into public.support_tickets (client_id,created_by,subject) values (%L,%L,'sneaky')$q$, t.id('cB'), t.id('ua')), 'row-level security');
  perform t.throws('client cannot open ticket as another user',
    format($q$insert into public.support_tickets (client_id,created_by,subject) values (%L,%L,'sneaky')$q$, t.id('cA'), t.id('ub')), 'row-level security');
  insert into public.support_tickets (client_id, created_by, subject, status, assigned_to, priority)
    values (t.id('cA'), t.id('ua'), 'Need a new mailbox', 'resolved', t.id('staff'), 'high') returning id into v_tid;
  perform t.check('client-created ticket is forced to open and unassigned',
    (select status = 'open' and assigned_to is null from public.support_tickets where id = v_tid));
  perform t.throws('client cannot reply on another client ticket',
    format($q$insert into public.support_messages (ticket_id,author_id,body) values (%L,%L,'hi')$q$, t.id('tB'), t.id('ua')), 'row-level security');
  perform t.throws('client cannot spoof message author',
    format($q$insert into public.support_messages (ticket_id,author_id,body) values (%L,%L,'hi')$q$, t.id('tA'), t.id('ub')), 'row-level security');
  perform t.check('client can reply on own ticket',
    t.affected(format($q$insert into public.support_messages (ticket_id,author_id,body,author_role,author_name) values (%L,%L,'Any update?','admin','CEO')$q$, t.id('tA'), t.id('ua'))) = 1);
  perform t.check('message author role/name cannot be spoofed',
    (select author_role = 'client' and author_name <> 'CEO' from public.support_messages where body = 'Any update?'));
  perform t.check('client cannot edit tickets directly (0 rows)', t.affected($q$update public.support_tickets set status='resolved'$q$) = 0);
  perform public.close_ticket(t.id('tA'));
  perform t.check('ticket is closed with timestamp',        (select status = 'closed' and closed_at is not null from public.support_tickets where id = t.id('tA')));
  perform t.throws('client cannot reply on a closed ticket',
    format($q$insert into public.support_messages (ticket_id,author_id,body) values (%L,%L,'late')$q$, t.id('tA'), t.id('ua')), 'row-level security');
  perform t.throws('client cannot close another client ticket', format('select public.close_ticket(%L)', t.id('tB')), 'not found');

  -- domains
  perform t.throws('client cannot toggle auto-renew on another client domain', format('select public.set_domain_auto_renew(%L, true)', t.id('dB')), 'not found');
  perform t.throws('unknown ids look identical to forbidden ones', format('select public.set_domain_auto_renew(%L, true)', gen_random_uuid()), 'not found');
  perform public.set_domain_auto_renew(t.id('dA'), true);
  perform t.check('client can toggle auto-renew on own domain', (select auto_renew from public.domains where id = t.id('dA')));

  -- notifications
  perform t.throws('client cannot edit notification content', $q$update public.notifications set title='x'$q$, 'permission denied');
  perform t.check('client can mark own notifications read', t.affected(format($q$update public.notifications set read_at=now() where user_id=%L$q$, t.id('ua'))) >= 1);
  perform t.check('client cannot touch others notifications', t.affected(format($q$update public.notifications set read_at=now() where user_id=%L$q$, t.id('staff'))) = 0);

  -- privileged RPCs
  perform t.throws('client cannot send invoices',            format('select public.send_invoice(%L)', t.id('iAd')), 'not allowed');
  perform t.throws('client cannot mark invoices paid',       format($q$select public.mark_invoice_paid(%L,'cash')$q$, t.id('iAs')), 'not allowed');
  perform t.throws('client cannot change roles',             format($q$select public.admin_update_profile(%L,'admin')$q$, t.id('ua')), 'not allowed');
  perform t.throws('client cannot assign users to clients',  format('select public.staff_assign_user_to_client(%L,%L)', t.id('ua'), t.id('cB')), 'not allowed');
  perform t.throws('client cannot call the maintenance job', 'select public.run_daily_maintenance()', 'permission denied');
  perform t.throws('client cannot call the rate limiter',    $q$select public.rate_limit_hit('k',1,1)$q$, 'permission denied');
  perform t.throws('client cannot call log_activity',        $q$select public.log_activity('x')$q$, 'permission denied');
  perform t.throws('client cannot read the private schema tables', 'select * from private.rate_limits', 'permission denied');
  perform t.as_root();
end $$;

-- ---------------------------------------------------------------------
-- 3. Accounts that must see nothing
-- ---------------------------------------------------------------------
do $$
begin
  perform t.as_user('uarch');
  perform t.check('user of an archived client sees nothing', t.n('select 1 from public.domains') = 0 and t.n('select 1 from public.invoices') = 0 and t.n('select 1 from public.clients') = 0);
  perform t.as_user('uinactive');
  perform t.check('deactivated user sees nothing', t.n('select 1 from public.domains') = 0 and t.n('select 1 from public.clients') = 0);
  perform t.as_user('uloose');
  perform t.check('client user with no client sees nothing', t.n('select 1 from public.domains') = 0 and t.n('select 1 from public.invoices') = 0);
  perform t.as_root();
end $$;

-- ---------------------------------------------------------------------
-- 4. Signup can never grant privileges
-- ---------------------------------------------------------------------
do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v, 'evil@x.test', jsonb_build_object('role','admin','client_id', t.id('cB'), 'full_name','Evil'));
  perform t.check('signup metadata cannot set role or client',
    (select role = 'client' and client_id is null and full_name = 'Evil' from public.profiles where id = v));
end $$;

-- ---------------------------------------------------------------------
-- 5. Staff
-- ---------------------------------------------------------------------
do $$
declare v_inv uuid; v_empty uuid; v_pay uuid; v_before int;
begin
  perform t.as_user('staff');
  perform t.check('staff sees all clients',          t.n('select 1 from public.clients') = 4);
  perform t.check('staff sees drafts and internal notes', t.n(format('select 1 from public.invoices where id=%L', t.id('iAd'))) = 1 and t.n('select 1 from public.internal_notes') = 1);
  perform t.check('staff can read servers and provider links', t.n('select 1 from public.servers') = 1 and t.n('select 1 from public.provider_links') = 1);
  perform t.throws('staff cannot create servers',    $q$insert into public.servers (name) values ('x')$q$, 'row-level security');
  perform t.check('staff cannot read settings',      t.n('select 1 from public.settings') = 0);
  perform t.throws('staff cannot change roles directly', format($q$update public.profiles set role='admin' where id=%L$q$, t.id('staff')), 'permission denied');
  perform t.throws('staff cannot call admin_update_profile', format($q$select public.admin_update_profile(%L,'admin')$q$, t.id('staff')), 'not allowed');
  perform t.check('staff cannot delete clients (admin only)', t.affected(format('delete from public.clients where id=%L', t.id('cD'))) = 0);
  perform t.check('staff can create clients', t.affected($q$insert into public.clients (company_name) values ('New Co')$q$) = 1);
  perform public.staff_assign_user_to_client(t.id('uloose'), t.id('cD'));
  perform t.check('staff can link a client user to a client', (select client_id = t.id('cD') from public.profiles where id = t.id('uloose')));
  perform t.throws('staff cannot re-link a staff user', format('select public.staff_assign_user_to_client(%L,%L)', t.id('staff2'), t.id('cD')), 'not a client user');
  perform t.throws('staff cannot write payments directly', format($q$insert into public.payments (invoice_id,client_id,provider,amount_cents,currency,status) values (%L,%L,'x',1,'USD','paid')$q$, t.id('iAs'), t.id('cA')), 'permission denied');
  perform t.throws('staff cannot edit the audit log', 'delete from public.activity_logs', 'permission denied');

  -- invoice lifecycle
  perform t.throws('new invoices must start as draft', format($q$insert into public.invoices (client_id,due_date,status) values (%L,current_date+7,'paid')$q$, t.id('cA')), 'row-level security');
  insert into public.invoices (client_id, due_date, currency) values (t.id('cA'), current_date + 14, 'USD') returning id into v_inv;
  perform t.check('invoice gets a generated number', (select number ~ '^INV-[0-9]{4}-[0-9]{4}$' from public.invoices where id = v_inv));
  perform t.throws('empty invoice cannot be sent', format('select public.send_invoice(%L)', v_inv), 'at least one item');
  insert into public.invoice_items (invoice_id, description, quantity, unit_price_cents) values (v_inv, 'Domain', 1, 1500), (v_inv, 'Care plan', 3, 2500);
  perform t.check('invoice total is computed from items (1500 + 3x2500)', (select subtotal_cents = 9000 and total_cents = 9000 from public.invoices where id = v_inv));
  perform t.throws('draft cannot jump to overdue', format($q$update public.invoices set status='overdue' where id=%L$q$, v_inv), 'invalid invoice status');
  perform t.throws('status cannot be edited straight to paid', format($q$update public.invoices set status='paid' where id=%L$q$, v_inv), 'invalid invoice status');
  perform public.send_invoice(v_inv);
  perform t.check('invoice can be sent', (select status = 'sent' and sent_at is not null from public.invoices where id = v_inv));
  perform t.throws('sent invoice items are locked (insert)', format($q$insert into public.invoice_items (invoice_id,description,unit_price_cents) values (%L,'x',1)$q$, v_inv), 'locked');
  perform t.throws('sent invoice items are locked (update)', format($q$update public.invoice_items set unit_price_cents=1 where invoice_id=%L$q$, v_inv), 'locked');
  perform t.throws('sent invoice items are locked (delete)', format('delete from public.invoice_items where invoice_id=%L', v_inv), 'locked');
  perform t.throws('sent invoice total is frozen', format('update public.invoices set total_cents=1 where id=%L', v_inv), 'locked');
  perform t.check('sent invoice cannot be deleted (0 rows)', t.affected(format('delete from public.invoices where id=%L', v_inv)) = 0);
  perform t.throws('sent invoice cannot go back to draft', format($q$update public.invoices set status='draft' where id=%L$q$, v_inv), 'invalid invoice status');
  perform t.throws('sent invoice cannot be marked paid by editing status', format($q$update public.invoices set status='paid' where id=%L$q$, v_inv), 'recording a payment');
  perform t.check('staff can mark an invoice overdue', t.affected(format($q$update public.invoices set status='overdue' where id=%L$q$, v_inv)) = 1);
  select public.mark_invoice_paid(v_inv, 'ecocash', 'EC-12345') into v_pay;
  perform t.check('mark paid records a payment and settles the invoice',
    (select i.status = 'paid' and i.paid_at is not null and p.amount_cents = 9000 and p.status = 'paid' and p.provider = 'manual'
       from public.invoices i join public.payments p on p.invoice_id = i.id where i.id = v_inv));
  perform t.throws('a paid invoice cannot be paid twice', format($q$select public.mark_invoice_paid(%L,'cash')$q$, v_inv), 'sent or overdue');
  perform t.throws('paid invoice cannot be cancelled', format($q$update public.invoices set status='cancelled' where id=%L$q$, v_inv), 'invalid invoice status');
  perform t.check('draft invoices can be deleted (items go with them)',
    t.affected(format('delete from public.invoices where id=%L', t.id('iAd'))) = 1 and t.n(format('select 1 from public.invoice_items where invoice_id=%L', t.id('iAd'))) = 0);
  perform t.check('draft invoice can be cancelled? (not allowed from paid; sent can)', t.affected(format($q$update public.invoices set status='cancelled' where id=%L$q$, t.id('iBs'))) = 1);

  -- tickets
  perform t.check('staff sees every ticket', t.n('select 1 from public.support_tickets') >= 2);
  perform t.throws('tickets can only be assigned to staff', format('update public.support_tickets set assigned_to=%L where id=%L', t.id('ua'), t.id('tB')), 'assigned to active staff');
  perform t.check('staff can assign a ticket', t.affected(format('update public.support_tickets set assigned_to=%L where id=%L', t.id('staff2'), t.id('tB'))) = 1);
  perform t.check('staff can reply to a ticket', t.affected(format($q$insert into public.support_messages (ticket_id,author_id,body) values (%L,%L,'On it')$q$, t.id('tB'), t.id('staff'))) = 1);
  perform t.check('staff reply moves an open ticket to in progress', (select status = 'in_progress' from public.support_tickets where id = t.id('tB')));
  perform t.check('staff can set waiting_for_client', t.affected(format($q$update public.support_tickets set status='waiting_for_client' where id=%L$q$, t.id('tB'))) = 1);
  perform t.throws('staff cannot post a note as someone else', format($q$insert into public.internal_notes (entity_type,entity_id,body,author_id) values ('ticket',%L,'x',%L)$q$, t.id('tB'), t.id('admin')), 'row-level security');
  perform t.check('staff can add internal notes', t.affected(format($q$insert into public.internal_notes (entity_type,entity_id,client_id,body,author_id) values ('ticket',%L,%L,'Customer is on holiday',%L)$q$, t.id('tB'), t.id('cB'), t.id('staff'))) = 1);
  perform t.as_root();

  -- a client reply on a waiting ticket re-opens it
  perform t.as_user('ub');
  insert into public.support_messages (ticket_id, author_id, body) values (t.id('tB'), t.id('ub'), 'Here is the file');
  perform t.check('client reply re-opens a waiting ticket', (select status = 'open' from public.support_tickets where id = t.id('tB')));
  perform t.check('client cannot see internal notes on their ticket', t.n('select 1 from public.internal_notes') = 0);
  perform t.as_root();
end $$;

-- ---------------------------------------------------------------------
-- 6. Notifications generated by the rules above
-- ---------------------------------------------------------------------
do $$
begin
  perform t.check('client B was notified when their invoice was cancelled? (no) but told of staff reply',
     t.n(format($q$select 1 from public.notifications where user_id=%L and type='ticket_update' and title='New reply on your ticket'$q$, t.id('ub'))) = 1);
  perform t.check('client A was notified of the sent invoice',
     t.n(format($q$select 1 from public.notifications where user_id=%L and type='invoice_created'$q$, t.id('ua'))) >= 2);
  perform t.check('client A was notified of the payment',
     t.n(format($q$select 1 from public.notifications where user_id=%L and type='payment_received'$q$, t.id('ua'))) = 1);
  perform t.check('deactivated user gets no notifications',
     t.n(format('select 1 from public.notifications where user_id=%L', t.id('uinactive'))) = 0);
  -- 'Change logo' got one reply while unassigned (fixture: all staff told) and one after assignment (only staff2 told)
  perform t.check('assigned staff was told about the client reply',
     t.n(format($q$select 1 from public.notifications where user_id=%L and title = 'New reply: Change logo'$q$, t.id('staff2'))) = 2);
  perform t.check('other staff were not spammed once the ticket was assigned',
     t.n(format($q$select 1 from public.notifications where user_id=%L and title = 'New reply: Change logo'$q$, t.id('staff'))) = 1);
  -- website + mailbox status changes
  update public.websites set status = 'maintenance' where id = t.id('wA');
  update public.email_accounts set status = 'suspended' where address = 'info@arikhosuites.co.zw';
  perform t.check('website status change notifies the client', t.n(format($q$select 1 from public.notifications where user_id=%L and type='website_status'$q$, t.id('ua'))) = 1);
  perform t.check('mailbox change notifies the client',        t.n(format($q$select 1 from public.notifications where user_id=%L and type='email_service' and title like '%%is now suspended'$q$, t.id('ua'))) = 1);
end $$;

-- ---------------------------------------------------------------------
-- 7. Admin
-- ---------------------------------------------------------------------
do $$
begin
  perform t.as_user('admin');
  perform t.check('admin can create servers',     t.affected($q$insert into public.servers (name, provider) values ('sxi-vps-02','cpanel')$q$) = 1);
  perform t.check('admin can read/write settings', t.affected($q$update public.settings set value='{"name":"SXI"}'$q$) = 1);
  perform public.admin_update_profile(t.id('uloose'), 'staff', null, true);
  perform t.check('admin can promote a user to staff (and is detached from the client)', (select role = 'staff' and client_id is null from public.profiles where id = t.id('uloose')));
  perform t.throws('staff cannot belong to a client', format('select public.admin_update_profile(%L,%L,%L)', t.id('staff'), 'staff', t.id('cA')), 'do not belong to a client');
  perform t.throws('admin cannot demote themselves', format($q$select public.admin_update_profile(%L,'staff')$q$, t.id('admin')), 'yourself');
  perform t.throws('admin cannot deactivate themselves', format($q$select public.admin_update_profile(%L,'admin',null,false)$q$, t.id('admin')), 'yourself');
  perform public.admin_update_profile(t.id('admin2'), 'staff');
  perform t.check('admin can demote another admin', (select role = 'staff' from public.profiles where id = t.id('admin2')));
  perform t.throws('clients with data cannot be deleted', format('delete from public.clients where id=%L', t.id('cA')), 'violates foreign key');
  perform t.check('admin can delete a client that has no data', t.affected(format('delete from public.clients where id=%L', t.id('cD'))) = 1);
  perform t.throws('domain names must be lowercase', format($q$insert into public.domains (client_id,name) values (%L,'BAD.co.zw')$q$, t.id('cA')));
  perform t.as_root();
end $$;

-- ---------------------------------------------------------------------
-- 8. Audit log
-- ---------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  perform t.check('role changes are audited and hidden from clients',
    t.n($q$select 1 from public.activity_logs where action='profiles.update' and metadata->'changed' ? 'role' and not client_visible$q$) >= 1);
  perform t.check('status transitions are recorded with from/to',
    t.n($q$select 1 from public.activity_logs where action='invoices.update' and metadata->>'from' in ('sent','overdue') and metadata->>'to'='paid'$q$) >= 1);
  perform t.check('audit rows record who did it',
    t.n(format($q$select 1 from public.activity_logs where actor_id=%L and actor_role='staff'$q$, t.id('staff'))) >= 1);
  perform t.check('audit metadata never contains values of edited fields',
    t.n($q$select 1 from public.activity_logs where metadata::text ilike '%Pays late%' or metadata::text ilike '%Arikho Owner%'$q$) = 0);
  select count(*) into v_n from public.activity_logs;
  update public.hosting_accounts set storage_used_mb = 999, usage_synced_at = now() where id = t.id('hA');
  perform t.check('usage-only sync does not spam the log', (select count(*) from public.activity_logs) = v_n);
  update public.hosting_accounts set status = 'suspended' where id = t.id('hA');
  perform t.check('real hosting change is logged', (select count(*) from public.activity_logs) = v_n + 1);
  perform t.throws('even superuser cannot edit the log', 'update public.activity_logs set action = ''x''', 'append-only');
  perform t.throws('even superuser cannot delete from the log', 'delete from public.activity_logs', 'append-only');
  perform t.throws('nobody can truncate the log', 'truncate public.activity_logs', 'append-only');
end $$;

-- ---------------------------------------------------------------------
-- 9. Service-role jobs: maintenance + rate limit + app-level audit
-- ---------------------------------------------------------------------
do $$
declare r1 jsonb; r2 jsonb; v_n bigint; v_ok boolean[];
begin
  perform t.as_root();
  update public.hosting_accounts set status = 'active', renewal_date = current_date + 20 where id = t.id('hA');
  update public.domains set expires_at = current_date + 5 where id = t.id('dA');
  -- one invoice due yesterday (should go overdue), one due tomorrow (should get a reminder)
  insert into public.invoices (id, client_id, due_date, issue_date) values (t.mk('iLate'), t.id('cA'), current_date - 1, current_date - 15);
  insert into public.invoice_items (invoice_id, description, unit_price_cents) values (t.id('iLate'), 'Late thing', 500);
  update public.invoices set status = 'sent' where id = t.id('iLate');
  insert into public.invoices (id, client_id, due_date) values (t.mk('iSoon'), t.id('cA'), current_date + 1);
  insert into public.invoice_items (invoice_id, description, unit_price_cents) values (t.id('iSoon'), 'Soon thing', 700);
  update public.invoices set status = 'sent' where id = t.id('iSoon');

  perform t.as_service();
  select public.run_daily_maintenance() into r1;
  perform t.as_root();
  perform t.check('maintenance marks late invoices overdue', (select status = 'overdue' from public.invoices where id = t.id('iLate')));
  perform t.check('maintenance reports what it did', (r1->>'invoices_marked_overdue')::int = 1);
  perform t.check('overdue notification sent',   t.n(format($q$select 1 from public.notifications where user_id=%L and dedupe_key=%L$q$, t.id('ua'), 'invoice_overdue:' || t.id('iLate'))) = 1);
  perform t.check('due-soon reminder sent',      t.n(format($q$select 1 from public.notifications where user_id=%L and type='invoice_due'$q$, t.id('ua'))) = 1);
  perform t.check('domain expiry reminder sent', t.n(format($q$select 1 from public.notifications where user_id=%L and type='domain_expiring'$q$, t.id('ua'))) = 1);
  perform t.check('hosting renewal reminder sent', t.n(format($q$select 1 from public.notifications where user_id=%L and type='hosting_renewal'$q$, t.id('ua'))) = 1);
  select count(*) into v_n from public.notifications;
  perform t.as_service();
  select public.run_daily_maintenance() into r2;
  perform t.as_root();
  perform t.check('running maintenance twice does not duplicate notifications', (select count(*) from public.notifications) = v_n);

  perform t.as_service();
  v_ok := array[public.rate_limit_hit('login:1.2.3.4', 3, 60), public.rate_limit_hit('login:1.2.3.4', 3, 60),
                public.rate_limit_hit('login:1.2.3.4', 3, 60), public.rate_limit_hit('login:1.2.3.4', 3, 60)];
  perform t.check('rate limiter allows 3 then blocks', v_ok = array[true,true,true,false]);
  perform t.check('rate limiter is per key', public.rate_limit_hit('login:5.6.7.8', 3, 60));
  perform public.log_activity('auth.login_failed', null, null, null, null, '{"email":"a@b.c"}', '203.0.113.9', false);
  perform t.as_root();
  perform t.check('app-level audit events can be written by the service role',
    t.n($q$select 1 from public.activity_logs where action='auth.login_failed' and ip='203.0.113.9'$q$) = 1);
end $$;

-- ---------------------------------------------------------------------
-- 10. Helpers used by the browser dashboard (migration 0003)
-- ---------------------------------------------------------------------
do $$
declare v_id uuid; v_n bigint;
begin
  perform t.as_user('ub');
  v_id := public.create_ticket('Renew my domain', 'Please renew blueridge.co.zw', 'domain_renewal', 'urgent', 'domain', t.id('dB'));
  perform t.as_root();
  perform t.check('create_ticket makes the ticket and its first message',
    (select client_id = t.id('cB') and created_by = t.id('ub') and status = 'open' and priority = 'high' from public.support_tickets where id = v_id)
    and t.n(format('select 1 from public.support_messages where ticket_id=%L', v_id)) = 1);
  perform t.check('urgent is clamped to high for clients', (select priority = 'high' from public.support_tickets where id = v_id));
  perform t.check('staff were notified of the new ticket',
    t.n(format($q$select 1 from public.notifications where user_id=%L and title='New ticket: Renew my domain'$q$, t.id('staff'))) = 1);

  perform t.as_user('ub');
  perform t.throws('cannot attach another client domain to a ticket',
    format($q$select public.create_ticket('Sneaky ticket','x','general','normal','domain',%L)$q$, t.id('dA')), 'not found');
  perform t.throws('related type without id is rejected', $q$select public.create_ticket('Half related','x','general','normal','domain',null)$q$, 'needs both');
  perform t.throws('subject length is enforced', $q$select public.create_ticket('x','body')$q$);
  perform t.as_user('staff');
  perform t.throws('staff cannot use the client ticket helper', $q$select public.create_ticket('From staff','x')$q$, 'not allowed');
  perform t.as_user('uloose');
  perform t.as_root();
  perform t.as_anon();
  perform t.throws('anon cannot create tickets', $q$select public.create_ticket('Anon ticket','x')$q$, 'permission denied');
  perform t.throws('anon cannot log events',     $q$select public.log_own_event('auth.login')$q$, 'permission denied');

  perform t.as_user('ua');
  perform public.log_own_event('auth.login');
  perform public.log_own_event('auth.login');
  perform t.throws('only allow-listed events can be logged', $q$select public.log_own_event('invoices.update')$q$, 'unknown event');
  perform t.as_root();
  perform t.check('own login is logged once (flood guard) and hidden from clients',
    t.n(format($q$select 1 from public.activity_logs where actor_id=%L and action='auth.login' and not client_visible and client_id=%L$q$, t.id('ua'), t.id('cA'))) = 1);
end $$;

-- ---------------------------------------------------------------------
-- 11. Admin helpers (migration 0004)
-- ---------------------------------------------------------------------
do $$
begin
  perform t.as_user('staff');
  perform t.throws('linking needs an existing client login', format($q$select public.staff_link_user_by_email('nobody@nowhere.test', %L)$q$, t.id('cA')), 'no client login');
  perform t.throws('staff accounts cannot be linked to a client', format($q$select public.staff_link_user_by_email('staff2@sxi.test', %L)$q$, t.id('cA')), 'no client login');
  perform public.staff_link_user_by_email('  UB@B.TEST ', t.id('cB'));
  perform t.as_root();
  perform t.check('staff can link a login to a client by email', (select client_id = t.id('cB') from public.profiles where email = 'ub@b.test'));
  perform t.as_user('ua');
  perform t.throws('clients cannot link logins', format($q$select public.staff_link_user_by_email('ub@b.test', %L)$q$, t.id('cA')), 'not allowed');
  perform t.throws('clients cannot change payment status', format($q$select public.set_payment_status(%L,'refunded')$q$, gen_random_uuid()), 'not allowed');
  perform t.as_root();

  insert into public.invoices (id, client_id, due_date) values (t.mk('iPend'), t.id('cA'), current_date + 7);
  insert into public.invoice_items (invoice_id, description, unit_price_cents) values (t.id('iPend'), 'Gateway item', 2500);
  update public.invoices set status = 'sent' where id = t.id('iPend');
  insert into public.payments (id, invoice_id, client_id, provider, provider_reference, amount_cents, currency, status)
    values (t.mk('payPend'), t.id('iPend'), t.id('cA'), 'paynow', 'PN-1', 2500, 'USD', 'pending');

  perform t.as_user('staff');
  perform t.throws('a pending payment cannot be refunded', format($q$select public.set_payment_status(%L,'refunded')$q$, t.id('payPend')), 'cannot become');
  perform public.set_payment_status(t.id('payPend'), 'paid');
  perform t.as_root();
  perform t.check('marking a pending payment paid settles the invoice', (select status = 'paid' from public.invoices where id = t.id('iPend')));
  perform t.as_user('staff');
  perform public.set_payment_status(t.id('payPend'), 'refunded');
  perform t.throws('a refunded payment is final', format($q$select public.set_payment_status(%L,'paid')$q$, t.id('payPend')), 'cannot become');
  perform t.as_root();
  perform t.check('refunded status is recorded', (select status = 'refunded' from public.payments where id = t.id('payPend')));
end $$;

-- ---------------------------------------------------------------------
-- Result
-- ---------------------------------------------------------------------
select case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail
from t.results where not ok order by n;

do $$
declare v_fail int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t.results;
  raise notice '% checks, % failed', v_total, v_fail;
  if v_fail > 0 then raise exception '% test(s) failed', v_fail; end if;
end $$;
