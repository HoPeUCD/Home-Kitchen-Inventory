-- 1. Create Zones table
create table if not exists public.chore_zones (
  id uuid not null default gen_random_uuid() primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique(household_id, name)
);

-- 2. Add RLS for Zones
alter table public.chore_zones enable row level security;

create policy "Users can view zones of their households"
on public.chore_zones for select
using (
  auth.uid() in (
    select user_id from public.household_members
    where household_id = chore_zones.household_id
  )
);

create policy "Users can manage zones of their households"
on public.chore_zones for all
using (
  auth.uid() in (
    select user_id from public.household_members
    where household_id = chore_zones.household_id
  )
);

-- 3. Update Chores table to link to Zones
alter table public.chores 
add column if not exists zone_id uuid references public.chore_zones(id) on delete set null;

-- 4. Migration: Create zones from existing text 'zone' column and link them
do $$
declare
  r record;
  z_id uuid;
begin
  for r in select distinct household_id, zone from public.chores where zone is not null loop
    -- Insert zone if not exists
    insert into public.chore_zones (household_id, name)
    values (r.household_id, r.zone)
    on conflict (household_id, name) do update set name = excluded.name -- no-op to get id? No, need returning
    returning id into z_id;
    
    -- If we didn't get an ID (because it existed), fetch it
    if z_id is null then
      select id into z_id from public.chore_zones 
      where household_id = r.household_id and name = r.zone;
    end if;

    -- Update chores
    update public.chores 
    set zone_id = z_id 
    where household_id = r.household_id and zone = r.zone;
  end loop;
end $$;
