-- =====================================================================
-- SXI Digital portal — 0001 core schema
-- Tables, enums, indexes. Security (RLS, triggers, RPCs) is in 0002.
--
-- Design notes
--  * "clients" IS the organization. A client can have many users
--    (profiles.client_id). There is no separate organizations table.
--  * "users" = Supabase auth.users (credentials, password hashing) plus
--    public.profiles (role + client link).
--  * Money is stored as integer minor units (cents). Currency per row.
--  * Nothing here stores passwords, API keys, SSH or root credentials.
--    Mailbox passwords never touch this database.
--  * Children reference parents with ON DELETE RESTRICT: production data
--    is archived (status), never cascaded away.
-- =====================================================================

create schema if not exists private;

-- ---------- enums ----------------------------------------------------
create type public.user_role         as enum ('client','staff','admin');
create type public.account_status    as enum ('active','suspended','archived');
create type public.service_type      as enum ('website','domain','hosting','business_email','care_plan','other');
create type public.service_status    as enum ('pending','active','suspended','cancelled','expired');
create type public.billing_cycle     as enum ('one_time','monthly','quarterly','yearly');
create type public.website_status    as enum ('building','live','maintenance','offline','suspended');
create type public.ssl_status        as enum ('active','pending','expired','none');
create type public.domain_status     as enum ('active','pending','expired','transferring','suspended');
create type public.hosting_status    as enum ('pending','active','suspended','terminated');
create type public.mailbox_status    as enum ('pending','active','suspended','deleted');
create type public.invoice_status    as enum ('draft','sent','paid','overdue','cancelled');
create type public.payment_status    as enum ('pending','paid','failed','refunded');
create type public.ticket_status     as enum ('open','in_progress','waiting_for_client','resolved','closed');
create type public.ticket_category   as enum ('general','change_request','domain_transfer','domain_renewal','mailbox_request','billing','technical');
create type public.ticket_priority   as enum ('low','normal','high','urgent');
create type public.notification_type as enum (
  'invoice_created','invoice_due','invoice_overdue','payment_received',
  'domain_expiring','hosting_renewal','website_status','ticket_update','email_service'
);

-- ---------- clients (organizations) ----------------------------------
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null check (length(trim(company_name)) between 1 and 200),
  contact_name  text check (length(contact_name) <= 200),
  email         text check (length(email) <= 320),
  phone         text check (length(phone) <= 40),
  address       text check (length(address) <= 1000),
  status        public.account_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index clients_status_idx on public.clients (status);
create index clients_company_idx on public.clients (lower(company_name));

-- ---------- profiles (one per auth user) -----------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '' check (length(full_name) <= 200),
  phone       text check (length(phone) <= 40),
  role        public.user_role not null default 'client',
  client_id   uuid references public.clients(id) on delete restrict,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- staff/admin are SXI employees and belong to no client
  constraint profiles_staff_no_client check (role = 'client' or client_id is null)
);
create index profiles_client_idx on public.profiles (client_id);
create index profiles_role_idx   on public.profiles (role);

-- ---------- servers (staff/admin only; no credentials stored) --------
create table public.servers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  ip_address    inet,
  provider      text not null default 'manual',   -- cloudpanel | cpanel | directadmin | plesk | vps | manual
  os            text,
  status        text not null default 'active' check (status in ('active','maintenance','offline')),
  cpu_cores     int  check (cpu_cores > 0),
  ram_mb        int  check (ram_mb > 0),
  disk_gb       int  check (disk_gb > 0),
  bandwidth_gb  int  check (bandwidth_gb > 0),
  -- Reference to WHERE the secret lives (e.g. an env var name). Never the secret itself.
  credentials_ref text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- services (what a client is billed for) -------------------
create table public.services (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete restrict,
  type          public.service_type not null,
  name          text not null check (length(trim(name)) between 1 and 200),
  status        public.service_status not null default 'pending',
  price_cents   bigint not null default 0 check (price_cents >= 0),
  currency      text not null default 'USD' check (currency in ('USD','ZWG')),
  billing_cycle public.billing_cycle not null default 'yearly',
  start_date    date,
  renewal_date  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index services_client_idx  on public.services (client_id, status);
create index services_renewal_idx on public.services (renewal_date) where status = 'active';

-- ---------- domains --------------------------------------------------
create table public.domains (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete restrict,
  name                text not null check (name = lower(name) and length(name) between 3 and 253),
  registrar           text,
  registered_at       date,
  expires_at          date,
  status              public.domain_status not null default 'pending',
  auto_renew          boolean not null default false,
  renewal_price_cents bigint check (renewal_price_cents >= 0),
  currency            text not null default 'USD' check (currency in ('USD','ZWG')),
  nameservers         text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index domains_name_key on public.domains (name);
create index domains_client_idx  on public.domains (client_id);
create index domains_expiry_idx  on public.domains (expires_at) where status = 'active';

-- ---------- hosting accounts ----------------------------------------
create table public.hosting_accounts (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete restrict,
  server_label          text,                 -- what clients may see instead of the servers row
  plan_name             text,
  status                public.hosting_status not null default 'pending',
  ssl_status            public.ssl_status not null default 'none',
  storage_used_mb       bigint not null default 0 check (storage_used_mb >= 0),
  storage_limit_mb      bigint check (storage_limit_mb >= 0),
  bandwidth_used_mb     bigint not null default 0 check (bandwidth_used_mb >= 0),
  bandwidth_limit_mb    bigint check (bandwidth_limit_mb >= 0),
  websites_limit        int check (websites_limit >= 0),
  databases_used        int not null default 0 check (databases_used >= 0),
  databases_limit       int check (databases_limit >= 0),
  email_accounts_limit  int check (email_accounts_limit >= 0),
  renewal_date          date,
  usage_synced_at       timestamptz,          -- last time usage came from the provider
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index hosting_client_idx  on public.hosting_accounts (client_id);
create index hosting_renewal_idx on public.hosting_accounts (renewal_date) where status = 'active';

-- ---------- websites -------------------------------------------------
create table public.websites (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete restrict,
  hosting_account_id uuid references public.hosting_accounts(id) on delete restrict,
  domain_id          uuid references public.domains(id) on delete restrict,
  name               text not null check (length(trim(name)) between 1 and 200),
  url                text check (url ~* '^https?://'),
  status             public.website_status not null default 'building',
  ssl_status         public.ssl_status not null default 'none',
  last_updated_at    timestamptz,
  renewal_date       date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index websites_client_idx  on public.websites (client_id);
create index websites_hosting_idx on public.websites (hosting_account_id);
create index websites_domain_idx  on public.websites (domain_id);

-- ---------- business email (no password column, by design) -----------
create table public.email_accounts (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete restrict,
  domain_id         uuid references public.domains(id) on delete restrict,
  address           text not null check (address = lower(address) and address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  storage_used_mb   bigint not null default 0 check (storage_used_mb >= 0),
  storage_limit_mb  bigint check (storage_limit_mb >= 0),
  status            public.mailbox_status not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index email_accounts_address_key on public.email_accounts (address);
create index email_accounts_client_idx on public.email_accounts (client_id);
create index email_accounts_domain_idx on public.email_accounts (domain_id);

-- ---------- invoices -------------------------------------------------
create sequence public.invoice_number_seq start 1;

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete restrict,
  number         text not null unique,
  status         public.invoice_status not null default 'draft',
  currency       text not null default 'USD' check (currency in ('USD','ZWG')),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  total_cents    bigint not null default 0 check (total_cents >= 0),
  issue_date     date not null default current_date,
  due_date       date not null,
  notes          text check (length(notes) <= 2000),   -- printed on the invoice; internal notes live in internal_notes
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint invoices_due_after_issue check (due_date >= issue_date)
);
create index invoices_client_idx on public.invoices (client_id, status);
create index invoices_due_idx    on public.invoices (due_date) where status in ('sent','overdue');

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  service_id       uuid references public.services(id) on delete set null,
  description      text not null check (length(trim(description)) between 1 and 500),
  quantity         numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  position         int not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- ---------- payments (provider-agnostic) -----------------------------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices(id) on delete restrict,
  client_id          uuid not null references public.clients(id) on delete restrict,
  provider           text not null,            -- 'manual' today; 'paynow' | 'stripe' later
  provider_reference text,                     -- gateway transaction id (idempotency key)
  method             text,                     -- cash | bank_transfer | ecocash | card ...
  amount_cents       bigint not null check (amount_cents > 0),
  currency           text not null check (currency in ('USD','ZWG')),
  status             public.payment_status not null default 'pending',
  paid_at            timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_client_idx  on public.payments (client_id, status);
create unique index payments_provider_ref_key
  on public.payments (provider, provider_reference) where provider_reference is not null;

-- ---------- support --------------------------------------------------
create table public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete restrict,
  created_by  uuid not null references auth.users(id) on delete restrict,
  subject     text not null check (length(trim(subject)) between 3 and 200),
  category    public.ticket_category not null default 'general',
  priority    public.ticket_priority not null default 'normal',
  status      public.ticket_status not null default 'open',
  assigned_to uuid references auth.users(id) on delete set null,
  -- optional link to what the ticket is about (validated in the app; kept loose on purpose)
  related_type text check (related_type in ('website','domain','hosting','email_account','invoice')),
  related_id   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index tickets_client_idx   on public.support_tickets (client_id, status);
create index tickets_status_idx   on public.support_tickets (status, updated_at desc);
create index tickets_assigned_idx on public.support_tickets (assigned_to) where assigned_to is not null;

create table public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.support_tickets(id) on delete restrict,
  author_id    uuid not null references auth.users(id) on delete restrict,
  author_name  text not null default '',   -- snapshot, so clients never need to read staff profiles
  author_role  public.user_role not null default 'client',
  body         text not null check (length(trim(body)) between 1 and 10000),
  created_at   timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- Internal (staff-only) notes on any entity. Kept in their own table so
-- clients can never read them, even by accident of a broad SELECT policy.
create table public.internal_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('client','service','website','domain','hosting','email_account','invoice','ticket')),
  entity_id   uuid not null,
  client_id   uuid references public.clients(id) on delete restrict,
  body        text not null check (length(trim(body)) between 1 and 10000),
  author_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index internal_notes_entity_idx on public.internal_notes (entity_type, entity_id, created_at desc);
create index internal_notes_client_idx on public.internal_notes (client_id);

-- ---------- notifications --------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  uuid references public.clients(id) on delete restrict,
  type       public.notification_type not null,
  title      text not null,
  body       text,
  link       text,
  dedupe_key text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ---------- audit log (append-only; enforced in 0002) ----------------
create table public.activity_logs (
  id             bigint generated always as identity primary key,
  actor_id       uuid,                         -- null = system / service role
  actor_role     text,
  client_id      uuid,                         -- no FK: the log must outlive anything
  action         text not null,                -- e.g. invoices.update, auth.login_failed
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,  -- column NAMES and status changes only; never secret values
  ip             text,
  client_visible boolean not null default false,
  created_at     timestamptz not null default now()
);
create index activity_client_idx on public.activity_logs (client_id, created_at desc) where client_visible;
create index activity_entity_idx on public.activity_logs (entity_type, entity_id, created_at desc);
create index activity_actor_idx  on public.activity_logs (actor_id, created_at desc);

-- ---------- settings (admin only) ------------------------------------
create table public.settings (
  key        text primary key check (key ~ '^[a-z0-9_.]+$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- rate limiting (server-side use only) ---------------------
create table private.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         int not null
);

-- ---------- provider_links (staff only) ------------------------------
-- Maps a portal record to its identity on a hosting panel / mail server.
-- Kept apart from client-visible tables because RLS is row-level, not
-- column-level: anything in a client-readable table is client-readable.
create table public.provider_links (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('hosting_account','email_account','domain')),
  entity_id   uuid not null,
  provider    text not null,                 -- cloudpanel | cpanel | directadmin | plesk | mailcow | manual ...
  external_id text,                          -- account/username/mailbox id on that provider
  server_id   uuid references public.servers(id) on delete restrict,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id)
);
create index provider_links_server_idx on public.provider_links (server_id);
