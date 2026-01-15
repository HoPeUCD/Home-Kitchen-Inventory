alter table public.chores
add column if not exists end_date date default null;
