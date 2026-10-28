-- OPTIONAL demo data so the dashboards aren't empty. Run once in the SQL Editor AFTER the four migrations.
-- Safe to skip in production. Delete the demo client afterwards from Admin → Clients if you no longer want it.
do $$
declare c uuid; h uuid; d uuid; i uuid;
begin
  if exists (select 1 from public.clients where company_name = 'Arikho Suites (demo)') then return; end if;
  insert into public.clients (company_name, contact_name, email, phone, address)
    values ('Arikho Suites (demo)', 'Demo Contact', 'demo@arikhosuites.example', '+263 77 000 0000', 'Harare') returning id into c;
  insert into public.domains (client_id, name, registrar, registered_at, expires_at, status, auto_renew, renewal_price_cents, nameservers)
    values (c, 'arikhosuites-demo.co.zw', 'Registrar', current_date - 300, current_date + 65, 'active', true, 1500, '{ns1.sxidigital.com,ns2.sxidigital.com}') returning id into d;
  insert into public.hosting_accounts (client_id, server_label, plan_name, status, ssl_status, storage_used_mb, storage_limit_mb, bandwidth_used_mb, bandwidth_limit_mb, websites_limit, databases_used, databases_limit, email_accounts_limit, renewal_date, usage_synced_at)
    values (c, 'sxi-vps-01', 'Business Hosting', 'active', 'active', 2458, 10240, 18432, 102400, 3, 2, 5, 10, current_date + 200, now()) returning id into h;
  insert into public.websites (client_id, hosting_account_id, domain_id, name, url, status, ssl_status, last_updated_at, renewal_date)
    values (c, h, d, 'Arikho Suites', 'https://arikhosuites-demo.co.zw', 'live', 'active', now() - interval '3 days', current_date + 200);
  insert into public.email_accounts (client_id, domain_id, address, status, storage_used_mb, storage_limit_mb)
    values (c, d, 'info@arikhosuites-demo.co.zw', 'active', 640, 5120);
  insert into public.services (client_id, type, name, status, price_cents, billing_cycle, renewal_date) values
    (c, 'website', 'Business website', 'active', 35000, 'one_time', null),
    (c, 'hosting', 'Business hosting', 'active', 12000, 'yearly', current_date + 200);
  insert into public.invoices (client_id, due_date, notes) values (c, current_date + 14, 'Thank you for your business.') returning id into i;
  insert into public.invoice_items (invoice_id, description, quantity, unit_price_cents, position) values
    (i, 'Business hosting (12 months)', 1, 12000, 0), (i, 'Domain renewal', 1, 1500, 1);
  update public.invoices set status = 'sent' where id = i;
  insert into public.servers (name, ip_address, provider, cpu_cores, ram_mb, disk_gb) values ('sxi-vps-01', '203.0.113.10', 'cloudpanel', 4, 8192, 160) on conflict (name) do nothing;
  insert into public.settings (key, value) values ('company.name', '"SXI Digital"') on conflict (key) do nothing;
end $$;
