-- 1. Create Chores table with advanced scheduling support
create table if not exists public.chores (
  id uuid not null default gen_random_uuid() primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  description text,
  zone text, -- e.g. 'Bathroom', 'Kitchen'
  
  -- Basic Schedule
  frequency_days integer not null default 7,
  start_date date not null default current_date,
  
  -- Advanced Assignment Strategy
  assignment_strategy text default 'none', -- 'none', 'fixed', 'rotation'
  fixed_assignee_id uuid references auth.users(id),
  
  -- Rotation Logic
  -- If rotation, we cycle through this list of user_ids based on rotation_interval_days
  rotation_sequence uuid[] default null, 
  rotation_interval_days integer default 7, 
  
  archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Create Overrides table for exceptions (Skip, Reschedule, Swap)
create table if not exists public.chore_overrides (
  id uuid not null default gen_random_uuid() primary key,
  chore_id uuid not null references public.chores(id) on delete cascade,
  original_date date not null, -- The calculated due date being modified
  is_skipped boolean default false,
  new_assignee_id uuid references auth.users(id),
  new_date date, -- If rescheduled
  created_at timestamptz default now()
);

-- 3. Create Completions table
create table if not exists public.chore_completions (
  id uuid not null default gen_random_uuid() primary key,
  chore_id uuid not null references public.chores(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  notes text
);

-- 4. Enable RLS
alter table public.chores enable row level security;
alter table public.chore_overrides enable row level security;
alter table public.chore_completions enable row level security;

-- 5. Policies
-- Chores
create policy "Users can view chores of their households"
on public.chores for select
using (
  auth.uid() in (
    select user_id from public.household_members
    where household_id = chores.household_id
  )
);

create policy "Users can manage chores of their households"
on public.chores for all
using (
  auth.uid() in (
    select user_id from public.household_members
    where household_id = chores.household_id
  )
);

-- Overrides
create policy "Users can view overrides of their households"
on public.chore_overrides for select
using (
  exists (
    select 1 from public.chores
    join public.household_members on household_members.household_id = chores.household_id
    where chores.id = chore_overrides.chore_id
    and household_members.user_id = auth.uid()
  )
);

create policy "Users can manage overrides of their households"
on public.chore_overrides for all
using (
  exists (
    select 1 from public.chores
    join public.household_members on household_members.household_id = chores.household_id
    where chores.id = chore_overrides.chore_id
    and household_members.user_id = auth.uid()
  )
);

-- Completions
create policy "Users can view completions of their households"
on public.chore_completions for select
using (
  exists (
    select 1 from public.chores
    join public.household_members on household_members.household_id = chores.household_id
    where chores.id = chore_completions.chore_id
    and household_members.user_id = auth.uid()
  )
);

create policy "Users can manage completions of their households"
on public.chore_completions for all
using (
  exists (
    select 1 from public.chores
    join public.household_members on household_members.household_id = chores.household_id
    where chores.id = chore_completions.chore_id
    and household_members.user_id = auth.uid()
  )
);
