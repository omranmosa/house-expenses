create table receipts (
  id uuid primary key default gen_random_uuid(),
  worker text not null,
  authorizer text not null,
  store text,
  date date,
  total numeric(10,2),
  category text,
  items jsonb,
  notes text,
  image_url text,
  submitted_at timestamptz default now()
);

create table grocery_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  unit_price numeric(10,2),
  line_total numeric(10,2),
  purchased_at date
);
