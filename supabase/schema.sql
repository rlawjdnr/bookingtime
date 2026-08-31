create table if not exists public.clinic_settings (
  id text primary key default 'default',
  clinic_name text not null,
  phone text not null,
  open_days integer not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointment_time_blocks (
  id text primary key,
  time_label text not null,
  capacity integer not null default 0,
  is_open boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wait_time_rules (
  id uuid primary key default gen_random_uuid(),
  time_block_id text not null references public.appointment_time_blocks(id) on delete cascade,
  reservation_order integer not null,
  wait_minutes integer not null,
  created_at timestamptz not null default now(),
  unique (time_block_id, reservation_order)
);

create table if not exists public.reservations (
  id uuid primary key,
  patient_name text not null,
  appointment_date date not null,
  appointment_time text not null,
  treatment text not null,
  wait_minutes integer not null default 15,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.clinic_settings (id, clinic_name, phone, open_days)
values ('default', '이목구비 김한의원', '055-335-9799', 7)
on conflict (id) do update
set clinic_name = excluded.clinic_name,
    phone = excluded.phone,
    open_days = excluded.open_days,
    updated_at = now();

insert into public.appointment_time_blocks (id, time_label, capacity, is_open, sort_order)
values
  ('0900', '9:00', 3, true, 10),
  ('1000', '10:00', 0, false, 20),
  ('1100', '11:00', 1, true, 30),
  ('1200', '12:00', 5, true, 40),
  ('1400', '14:00', 5, true, 50),
  ('1500', '15:00', 5, true, 60),
  ('1600', '16:00', 5, true, 70),
  ('1700', '17:00', 5, true, 80),
  ('1730', '17:00', 5, true, 90)
on conflict (id) do update
set time_label = excluded.time_label,
    capacity = excluded.capacity,
    is_open = excluded.is_open,
    sort_order = excluded.sort_order,
    updated_at = now();

alter table public.clinic_settings enable row level security;
alter table public.appointment_time_blocks enable row level security;
alter table public.wait_time_rules enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "Public read clinic settings" on public.clinic_settings;
create policy "Public read clinic settings"
on public.clinic_settings for select
to anon
using (true);

drop policy if exists "Public read time blocks" on public.appointment_time_blocks;
create policy "Public read time blocks"
on public.appointment_time_blocks for select
to anon
using (true);

drop policy if exists "Public read wait rules" on public.wait_time_rules;
create policy "Public read wait rules"
on public.wait_time_rules for select
to anon
using (true);

drop policy if exists "Public read reservations" on public.reservations;
create policy "Public read reservations"
on public.reservations for select
to anon
using (true);

drop policy if exists "Public create reservations" on public.reservations;
create policy "Public create reservations"
on public.reservations for insert
to anon
with check (status = 'confirmed');

drop policy if exists "Public cancel reservations" on public.reservations;
create policy "Public cancel reservations"
on public.reservations for update
to anon
using (true)
with check (status in ('confirmed', 'cancelled'));

do $$
begin
  alter publication supabase_realtime add table public.reservations;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.appointment_time_blocks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.clinic_settings;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.wait_time_rules;
exception
  when duplicate_object then null;
end $$;
