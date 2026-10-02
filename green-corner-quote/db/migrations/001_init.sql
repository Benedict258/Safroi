create table components (
  id            serial primary key,
  name          text not null,
  category      text not null default 'General',
  description   text not null default '',
  unit_label    text not null default 'pc',
  markup_pct    numeric(6,2) not null default 10 check (markup_pct >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index components_category_idx on components (category);

create table supplier_listings (
  id               serial primary key,
  component_id     integer not null references components(id) on delete cascade,
  supplier         text not null check (supplier in ('microscale', 'hub360')),
  supplier_ref     text not null,
  title            text,
  units_per_listing integer not null default 1 check (units_per_listing > 0),
  price_ngn        numeric(12,2) check (price_ngn is null or price_ngn > 0),
  in_stock         boolean not null default true,
  status           text not null default 'pending'
                   check (status in ('pending', 'ok', 'held', 'stale', 'error')),
  last_synced_at   timestamptz,
  last_changed_at  timestamptz,
  last_error       text,
  unique (component_id, supplier)
);
create index supplier_listings_supplier_idx on supplier_listings (supplier);

create table price_history (
  id           bigserial primary key,
  listing_id   integer not null references supplier_listings(id) on delete cascade,
  price_ngn    numeric(12,2) not null,
  in_stock     boolean not null,
  captured_at  timestamptz not null default now()
);
create index price_history_listing_idx on price_history (listing_id, captured_at desc);

create table held_changes (
  id             serial primary key,
  listing_id     integer not null references supplier_listings(id) on delete cascade,
  old_price_ngn  numeric(12,2) not null,
  new_price_ngn  numeric(12,2) not null,
  detected_at    timestamptz not null default now(),
  decided_at     timestamptz,
  decision       text not null default 'pending'
                 check (decision in ('pending', 'approved', 'rejected'))
);
create index held_changes_pending_idx on held_changes (decision) where decision = 'pending';

create table bundles (
  id           serial primary key,
  name         text not null,
  description  text not null default '',
  active       boolean not null default true
);

create table bundle_items (
  id            serial primary key,
  bundle_id     integer not null references bundles(id) on delete cascade,
  component_id  integer not null references components(id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  unique (bundle_id, component_id)
);

create table quotes (
  id          serial primary key,
  name        text not null,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  total_ngn   numeric(14,2) not null default 0
);

-- Every price field is a snapshot taken at save time.
create table quote_lines (
  id                 serial primary key,
  quote_id           integer not null references quotes(id) on delete cascade,
  position           integer not null default 0,
  component_id       integer references components(id) on delete set null,
  bundle_id          integer references bundles(id) on delete set null,
  name               text not null,
  quantity           integer not null check (quantity > 0),
  supplier_used      text check (supplier_used in ('microscale', 'hub360')),
  supplier_price_ngn numeric(12,2),
  markup_pct         numeric(6,2),
  unit_price_ngn     numeric(12,2) not null,
  line_total_ngn     numeric(14,2) not null,
  detail             jsonb,
  warnings           jsonb not null default '[]'::jsonb,
  check ((component_id is null) or (bundle_id is null))
);
create index quote_lines_quote_idx on quote_lines (quote_id, position);

create table sync_runs (
  id             serial primary key,
  supplier       text not null check (supplier in ('microscale', 'hub360')),
  component_id   integer references components(id) on delete set null,
  trigger        text not null check (trigger in ('schedule', 'manual')),
  status         text not null default 'running'
                 check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  updated_count  integer not null default 0,
  unchanged_count integer not null default 0,
  failed_count   integer not null default 0,
  log            text not null default ''
);
create index sync_runs_started_idx on sync_runs (started_at desc);

create table settings (
  key    text primary key,
  value  text not null
);
insert into settings (key, value) values
  ('sync_times', '06:00,18:00'),
  ('price_jump_threshold_pct', '30'),
  ('stale_after_hours', '48');
